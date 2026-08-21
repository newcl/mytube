#!/usr/bin/env swift

import AppKit
import Foundation
import ImageIO
import UniformTypeIdentifiers

guard CommandLine.arguments.count == 3 else {
  fputs("Usage: generate_app_icons.swift <source-image> <appiconset-directory>\n", stderr)
  exit(64)
}

let sourceURL = URL(fileURLWithPath: CommandLine.arguments[1])
let outputDirectory = URL(fileURLWithPath: CommandLine.arguments[2], isDirectory: true)

guard let sourceImage = NSImage(contentsOf: sourceURL),
      sourceImage.size.width > 0,
      sourceImage.size.height > 0 else {
  fputs("Could not load source image: \(sourceURL.path)\n", stderr)
  exit(65)
}

let iconSizes: [String: Int] = [
  "Icon-App-20x20@1x.png": 20,
  "Icon-App-20x20@2x.png": 40,
  "Icon-App-20x20@3x.png": 60,
  "Icon-App-29x29@1x.png": 29,
  "Icon-App-29x29@2x.png": 58,
  "Icon-App-29x29@3x.png": 87,
  "Icon-App-40x40@1x.png": 40,
  "Icon-App-40x40@2x.png": 80,
  "Icon-App-40x40@3x.png": 120,
  "Icon-App-60x60@2x.png": 120,
  "Icon-App-60x60@3x.png": 180,
  "Icon-App-76x76@1x.png": 76,
  "Icon-App-76x76@2x.png": 152,
  "Icon-App-83.5x83.5@2x.png": 167,
  "Icon-App-1024x1024@1x.png": 1024,
]

for (filename, pixels) in iconSizes {
  guard let drawingContext = CGContext(
    data: nil,
    width: pixels,
    height: pixels,
    bitsPerComponent: 8,
    bytesPerRow: pixels * 4,
    space: CGColorSpaceCreateDeviceRGB(),
    bitmapInfo: CGImageAlphaInfo.noneSkipLast.rawValue
  ) else {
    fputs("Could not create \(filename)\n", stderr)
    exit(70)
  }

  let context = NSGraphicsContext(cgContext: drawingContext, flipped: false)

  NSGraphicsContext.saveGraphicsState()
  NSGraphicsContext.current = context
  context.imageInterpolation = .high

  let canvas = NSRect(x: 0, y: 0, width: pixels, height: pixels)
  NSColor.white.setFill()
  canvas.fill()

  // Keep the site's full logo visible inside the system-applied icon mask.
  let inset = CGFloat(pixels) * 0.06
  let availableWidth = CGFloat(pixels) - (inset * 2)
  let availableHeight = CGFloat(pixels) - (inset * 2)
  let sourceAspect = sourceImage.size.width / sourceImage.size.height

  let drawWidth: CGFloat
  let drawHeight: CGFloat
  if sourceAspect > availableWidth / availableHeight {
    drawWidth = availableWidth
    drawHeight = availableWidth / sourceAspect
  } else {
    drawHeight = availableHeight
    drawWidth = availableHeight * sourceAspect
  }

  let destination = NSRect(
    x: (CGFloat(pixels) - drawWidth) / 2,
    y: (CGFloat(pixels) - drawHeight) / 2,
    width: drawWidth,
    height: drawHeight
  )
  sourceImage.draw(
    in: destination,
    from: .zero,
    operation: .sourceOver,
    fraction: 1,
    respectFlipped: true,
    hints: [.interpolation: NSImageInterpolation.high]
  )

  NSGraphicsContext.restoreGraphicsState()

  guard let image = drawingContext.makeImage() else {
    fputs("Could not render \(filename)\n", stderr)
    exit(70)
  }
  let png = NSMutableData()
  guard let imageDestination = CGImageDestinationCreateWithData(
    png,
    UTType.png.identifier as CFString,
    1,
    nil
  ) else {
    fputs("Could not encode \(filename)\n", stderr)
    exit(70)
  }
  CGImageDestinationAddImage(imageDestination, image, nil)
  guard CGImageDestinationFinalize(imageDestination) else {
    fputs("Could not finalize \(filename)\n", stderr)
    exit(70)
  }
  try (png as Data).write(
    to: outputDirectory.appendingPathComponent(filename),
    options: .atomic
  )
}

print("Generated \(iconSizes.count) icons from \(sourceURL.lastPathComponent)")
