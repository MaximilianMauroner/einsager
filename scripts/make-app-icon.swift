import AppKit

let output = URL(fileURLWithPath: CommandLine.arguments[1])
guard let logo = NSImage(contentsOfFile: "assets/icons/einsager-breath.pdf") else {
    fatalError("The approved Breath e logo is missing")
}
let iconset = FileManager.default.temporaryDirectory
    .appendingPathComponent("einsager-\(UUID()).iconset", isDirectory: true)
try FileManager.default.createDirectory(at: iconset, withIntermediateDirectories: true)
defer { try? FileManager.default.removeItem(at: iconset) }

for size in [16, 32, 128, 256, 512] {
    for scale in [1, 2] {
        let pixels = size * scale
        guard let bitmap = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: pixels, pixelsHigh: pixels,
            bitsPerSample: 8, samplesPerPixel: 4, hasAlpha: true, isPlanar: false,
            colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0),
              let context = NSGraphicsContext(bitmapImageRep: bitmap) else {
            fatalError("Cannot render the application icon")
        }
        NSGraphicsContext.saveGraphicsState()
        NSGraphicsContext.current = context
        context.cgContext.scaleBy(x: CGFloat(pixels) / 1024, y: CGFloat(pixels) / 1024)
        let tile = NSBezierPath(roundedRect: NSRect(x: 100, y: 100, width: 824, height: 824),
                               xRadius: 180, yRadius: 180)
        NSColor(calibratedWhite: 0.075, alpha: 1).setFill()
        tile.fill()
        NSColor(calibratedWhite: 0.2, alpha: 1).setStroke()
        tile.lineWidth = 2
        tile.stroke()

        // Tint the existing vector logo without changing its paths.
        let mark = NSRect(x: 192, y: 192, width: 640, height: 640)
        context.cgContext.beginTransparencyLayer(auxiliaryInfo: nil)
        logo.draw(in: mark)
        context.cgContext.setBlendMode(.sourceIn)
        NSColor.white.setFill()
        NSBezierPath(rect: mark).fill()
        context.cgContext.endTransparencyLayer()
        NSGraphicsContext.restoreGraphicsState()

        guard let png = bitmap.representation(using: .png, properties: [:]) else {
            fatalError("Cannot encode the application icon")
        }
        let suffix = scale == 2 ? "@2x" : ""
        try png.write(to: iconset.appendingPathComponent("icon_\(size)x\(size)\(suffix).png"))
    }
}

let converter = Process()
converter.executableURL = URL(fileURLWithPath: "/usr/bin/iconutil")
converter.arguments = ["-c", "icns", iconset.path, "-o", output.path]
try converter.run()
converter.waitUntilExit()
guard converter.terminationStatus == 0 else { fatalError("Application icon conversion failed") }
print("Application icon: \(output.path)")
