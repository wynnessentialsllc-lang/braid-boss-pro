//
//  TapToPayPlugin.m
//  Braid Boss Pro
//
//  Registers the Swift TapToPayPlugin with Capacitor's plugin registry via
//  the Objective-C runtime. This is what makes window.Capacitor.Plugins
//  .TapToPay (and isPluginAvailable("TapToPay")) resolve in the WebView —
//  including when the shell loads the remote site — without needing a
//  `cap sync`-generated plugin list.
//
//  Requires the app target to have a bridging header that imports
//  <Capacitor/Capacitor.h> (see docs/tap_to_pay_setup.md).
//

#import <Foundation/Foundation.h>
#import <Capacitor/Capacitor.h>

CAP_PLUGIN(TapToPayPlugin, "TapToPay",
    CAP_PLUGIN_METHOD(isSupported, CAPPluginReturnPromise);
    CAP_PLUGIN_METHOD(collectPayment, CAPPluginReturnPromise);
    CAP_PLUGIN_METHOD(addListener, CAPPluginReturnCallback);
    CAP_PLUGIN_METHOD(removeAllListeners, CAPPluginReturnPromise);
)
