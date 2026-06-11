//
//  TapToPayPlugin.swift
//  Braid Boss Pro
//
//  Native bridge for Tap to Pay on iPhone, exposed to the web layer as the
//  Capacitor plugin "TapToPay" (see app/lib/taptopay.ts). It wraps the
//  Stripe Terminal iOS SDK's Tap to Pay (appleBuiltIn) reader.
//
//  ── Targeted SDK ────────────────────────────────────────────────────────
//  Stripe Terminal iOS SDK 5.x (Swift Package:
//  https://github.com/stripe/stripe-terminal-ios, "up to next major" from
//  5.0). Minimum iOS 15; Tap to Pay itself needs an iPhone XS or later on a
//  recent iOS. The symbol names below follow the 5.x public API. If you pin
//  a different major version, let Xcode autocomplete confirm the delegate
//  setter / callback signatures — they are the only things that have churned
//  across versions.
//
//  ── Flow (driven from JS) ───────────────────────────────────────────────
//  JS fetches a connection token + Terminal location and a card_present
//  PaymentIntent from our backend, then calls collectPayment(...). Here we:
//    1. discover the built-in Tap to Pay reader,
//    2. connect it to the merchant's Terminal location,
//    3. retrieve → collect → confirm the PaymentIntent on-device,
//    4. resolve with { status, paymentIntentId }.
//
//  Capture is automatic, so a confirmed intent means the money moved; the
//  web layer marks the appointment paid (method = tap_to_pay).
//

import Foundation
import Capacitor
import StripeTerminal

// Supplies the short-lived connection token that JS already fetched from
// our /api/stripe-connect/terminal/token endpoint. The SDK may ask again
// if a token expires mid-session; for a single transaction the cached one
// is sufficient, and we surface a clear error if it's missing.
final class TapToPayTokenProvider: NSObject, ConnectionTokenProvider {
    private var token: String?

    func setToken(_ token: String) { self.token = token }

    func fetchConnectionToken(_ completion: @escaping ConnectionTokenCompletionBlock) {
        if let token = token, !token.isEmpty {
            completion(token, nil)
        } else {
            completion(nil, NSError(
                domain: "TapToPay",
                code: 1,
                userInfo: [NSLocalizedDescriptionKey: "No Stripe connection token available."]
            ))
        }
    }
}

@objc(TapToPayPlugin)
public class TapToPayPlugin: CAPPlugin, DiscoveryDelegate, TapToPayReaderDelegate {

    private let tokenProvider = TapToPayTokenProvider()
    private var didConfigure = false

    // In-flight transaction state. Only one runs at a time.
    private var pendingCall: CAPPluginCall?
    private var pendingClientSecret: String?
    private var pendingLocationId: String?
    private var discoverCancelable: Cancelable?
    private var collectCancelable: Cancelable?
    private var connecting = false

    public override func load() {
        configureTerminal()
    }

    // Emit a configuration/charge status event the web layer renders as a
    // progress indicator (App Review requirement). Listeners are attached
    // from JS via addListener("tapToPayStatus", ...).
    private func emitStatus(_ stage: String, progress: Float? = nil) {
        var payload: [String: Any] = ["stage": stage]
        if let progress = progress { payload["progress"] = progress }
        notifyListeners("tapToPayStatus", data: payload)
    }

    // Terminal.setTokenProvider must be called once, before the first
    // Terminal.shared access.
    private func configureTerminal() {
        guard !didConfigure else { return }
        Terminal.setTokenProvider(tokenProvider)
        didConfigure = true
    }

    // MARK: - Plugin API

    @objc func isSupported(_ call: CAPPluginCall) {
        configureTerminal()
        let result = Terminal.shared.supportsReaders(
            of: .appleBuiltIn,
            discoveryMethod: .tapToPay,
            simulated: false
        )
        switch result {
        case .success:
            call.resolve(["supported": true])
        case .failure(let error):
            call.resolve(["supported": false, "reason": error.localizedDescription])
        }
    }

    @objc func collectPayment(_ call: CAPPluginCall) {
        guard let connectionToken = call.getString("connectionToken"),
              let locationId = call.getString("locationId"),
              let clientSecret = call.getString("clientSecret") else {
            call.reject("Missing connectionToken, locationId, or clientSecret.")
            return
        }
        guard pendingCall == nil else {
            call.reject("A Tap to Pay payment is already in progress.")
            return
        }

        configureTerminal()
        tokenProvider.setToken(connectionToken)
        call.keepAlive = true
        pendingCall = call
        pendingClientSecret = clientSecret
        pendingLocationId = locationId

        // SDK calls must run on the main thread.
        DispatchQueue.main.async { [weak self] in
            guard let self = self else { return }

            // Already connected (e.g. a second sale in the same session) —
            // skip discovery and go straight to the charge.
            if Terminal.shared.connectionStatus == .connected {
                self.processPayment()
                return
            }

            self.emitStatus("preparing")
            do {
                let config = try TapToPayDiscoveryConfigurationBuilder().build()
                self.discoverCancelable = Terminal.shared.discoverReaders(config, delegate: self) { error in
                    if let error = error {
                        self.finish(error: "Couldn't start Tap to Pay: \(error.localizedDescription)")
                    }
                }
            } catch {
                self.finish(error: "Tap to Pay isn't available on this device: \(error.localizedDescription)")
            }
        }
    }

    // MARK: - DiscoveryDelegate

    public func terminal(_ terminal: Terminal, didUpdateDiscoveredReaders readers: [Reader]) {
        guard !connecting,
              pendingCall != nil,
              let reader = readers.first,
              let locationId = pendingLocationId else { return }
        connecting = true
        emitStatus("connecting")

        do {
            let connectionConfig = try TapToPayConnectionConfigurationBuilder(locationId: locationId)
                .setTapToPayReaderDelegate(self)
                .build()
            Terminal.shared.connectReader(reader, connectionConfig: connectionConfig) { [weak self] _, error in
                guard let self = self else { return }
                self.connecting = false
                self.discoverCancelable?.cancel { _ in }
                self.discoverCancelable = nil
                if let error = error {
                    self.finish(error: "Couldn't connect the reader: \(error.localizedDescription)")
                    return
                }
                self.processPayment()
            }
        } catch {
            connecting = false
            finish(error: "Reader connection setup failed: \(error.localizedDescription)")
        }
    }

    // MARK: - Charge

    private func processPayment() {
        guard let clientSecret = pendingClientSecret else {
            finish(error: "Missing payment details.")
            return
        }
        emitStatus("ready")

        Terminal.shared.retrievePaymentIntent(clientSecret: clientSecret) { [weak self] intent, error in
            guard let self = self else { return }
            if let error = error {
                self.finish(error: "Couldn't load the charge: \(error.localizedDescription)")
                return
            }
            guard let intent = intent else {
                self.finish(error: "Couldn't load the charge.")
                return
            }

            self.emitStatus("presenting")
            self.collectCancelable = Terminal.shared.collectPaymentMethod(intent) { collected, collectError in
                if let collectError = collectError {
                    let nsError = collectError as NSError
                    let canceled = nsError.code == ErrorCode.canceled.rawValue
                    self.finish(error: collectError.localizedDescription, canceled: canceled)
                    return
                }
                guard let collected = collected else {
                    self.finish(error: "No card was read.")
                    return
                }

                self.emitStatus("processing")
                Terminal.shared.confirmPaymentIntent(collected) { confirmed, confirmError in
                    if let confirmError = confirmError {
                        self.finish(error: "The card was declined: \(confirmError.localizedDescription)")
                        return
                    }
                    self.finishSuccess(paymentIntentId: confirmed?.stripeId ?? "")
                }
            }
        }
    }

    // MARK: - Resolve / reject + teardown

    private func finishSuccess(paymentIntentId: String) {
        pendingCall?.resolve(["status": "succeeded", "paymentIntentId": paymentIntentId])
        clearPending()
    }

    private func finish(error: String, canceled: Bool = false) {
        if canceled {
            pendingCall?.resolve(["status": "canceled"])
        } else {
            pendingCall?.reject(error)
        }
        clearPending()
    }

    private func clearPending() {
        discoverCancelable?.cancel { _ in }
        discoverCancelable = nil
        collectCancelable = nil
        connecting = false
        pendingCall = nil
        pendingClientSecret = nil
        pendingLocationId = nil
    }

    // MARK: - TapToPayReaderDelegate
    //
    // Required by the SDK for software-update progress during the (first
    // time) reader preparation. We don't surface a separate UI for it — the
    // system Tap to Pay sheet covers the customer-facing experience — so
    // these are best-effort no-ops. Confirm the exact signatures against
    // your pinned SDK version if the build complains.

    public func tapToPayReader(_ reader: Reader, didStartInstallingUpdate update: ReaderSoftwareUpdate, cancelable: Cancelable?) {
        emitStatus("updating", progress: 0)
    }

    public func tapToPayReader(_ reader: Reader, didReportReaderSoftwareUpdateProgress progress: Float) {
        emitStatus("updating", progress: progress)
    }

    public func tapToPayReader(_ reader: Reader, didFinishInstallingUpdate update: ReaderSoftwareUpdate?, error: Error?) {}
}
