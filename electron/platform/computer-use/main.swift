import ApplicationServices
import Foundation
import Darwin

do {
    guard CommandLine.arguments.count == 2 else { throw HelperError(code: "invalid_arguments", message: "Use a supported fixed helper mode.", exitCode: 64) }
    switch CommandLine.arguments[1] {
    case "--status": emit(status())
    case "--parent-activity": emit(parentActivity())
    case "--targets": try targets(readTargetsRequest())
    case "--windows": try sharedWindows()
    case "--window-targets": try windowTargets(readWindowRequest(allowScope: true))
    case "--window-capture": try windowCapture(readWindowRequest())
    case "--click": try click(readClickRequest())
    case "--set-text": try setText(readSetTextRequest())
    case "--scroll": try scroll(readScrollRequest())
    case "--request-permission":
        let options = [kAXTrustedCheckOptionPrompt.takeUnretainedValue() as String: true] as CFDictionary
        _ = AXIsProcessTrustedWithOptions(options)
        emit(status())
    default: throw HelperError(code: "invalid_arguments", message: "Use a supported fixed helper mode.", exitCode: 64)
    }
} catch let error as HelperError {
    emit(["ok": false, "dispatched": error.unknown ? "unknown" as Any : false, "error": ["code": error.code, "message": error.message]])
    exit(error.exitCode)
} catch {
    emit(["ok": false, "dispatched": false, "error": ["code": "invalid_request", "message": "Cannot read the AX target request."]])
    exit(64)
}
