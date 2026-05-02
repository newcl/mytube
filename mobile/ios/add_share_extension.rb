#!/usr/bin/env ruby
# add_share_extension.rb
# Run once from mobile/ios/ to wire the ShareExtension target into the Xcode project.
# Usage: cd mobile/ios && ruby add_share_extension.rb

require 'xcodeproj'

PROJECT_PATH = 'Runner.xcodeproj'
APP_GROUP    = 'group.com.mytube.mobile'
BUNDLE_ID    = 'com.mytube.mobile'
EXT_NAME     = 'ShareExtension'
EXT_BUNDLE   = "#{BUNDLE_ID}.share"
SWIFT_VER    = '5.0'
DEPLOYMENT   = '16.0'

project = Xcodeproj::Project.open(PROJECT_PATH)
main_target = project.targets.find { |t| t.name == 'Runner' }

# ── Create extension target ───────────────────────────────────────────────────
ext_target = project.new_target(
  :app_extension,
  EXT_NAME,
  :ios,
  DEPLOYMENT,
  nil,
  :swift
)

# ── Add source file ───────────────────────────────────────────────────────────
ext_group = project.main_group.find_subpath(EXT_NAME, true)
ext_group.set_source_tree('<group>')
ext_group.set_path(EXT_NAME)

src = ext_group.new_file('ShareViewController.swift')
ext_target.source_build_phase.add_file_reference(src)

info = ext_group.new_file('Info.plist')
ext_target.build_configurations.each do |config|
  config.build_settings['INFOPLIST_FILE'] = "#{EXT_NAME}/Info.plist"
  config.build_settings['PRODUCT_BUNDLE_IDENTIFIER'] = EXT_BUNDLE
  config.build_settings['SWIFT_VERSION'] = SWIFT_VER
  config.build_settings['IPHONEOS_DEPLOYMENT_TARGET'] = DEPLOYMENT
  config.build_settings['CODE_SIGN_ENTITLEMENTS'] = "#{EXT_NAME}/ShareExtension.entitlements"
  config.build_settings['TARGETED_DEVICE_FAMILY'] = '1,2'
  config.build_settings['SKIP_INSTALL'] = 'YES'
end

ent = ext_group.new_file('ShareExtension.entitlements')

# ── Embed extension into main app ─────────────────────────────────────────────
embed_phase = main_target.new_copy_files_build_phase('Embed App Extensions')
embed_phase.dst_subfolder_spec = '13' # Plug-ins
ref = project.products_group.files.find { |f| f.path == "#{EXT_NAME}.appex" } ||
      project.products_group.new_file("#{EXT_NAME}.appex")
ref.explicit_file_type = 'wrapper.app-extension'
ref.source_tree = 'BUILT_PRODUCTS_DIR'
build_file = embed_phase.add_file_reference(ref)
build_file.settings = { 'ATTRIBUTES' => ['RemoveHeadersOnCopy'] }

# ── Wire entitlements for Runner ──────────────────────────────────────────────
main_target.build_configurations.each do |config|
  config.build_settings['CODE_SIGN_ENTITLEMENTS'] = 'Runner/Runner.entitlements'
end

project.save
puts "✓ ShareExtension target added to #{PROJECT_PATH}"
puts "Next: open Runner.xcworkspace in Xcode, set your Team for both targets, and build."
