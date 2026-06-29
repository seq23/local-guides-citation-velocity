#!/usr/bin/env ruby
# frozen_string_literal: true

require 'find'
require 'zlib'
require 'time'

root = File.expand_path(ARGV[0] || '.')
zip_path = File.expand_path(ARGV[1] || 'snapshot.zip')
include_git = ARGV.include?('--include-git')
base = File.basename(root)

exclude_file = lambda do |rel|
  parts = rel.split('/')
  return true if parts.include?('node_modules')
  return true if parts.include?('.cache')
  return true if parts.include?('tmp')
  return true if parts.include?('logs')
  return true if parts.include?('.build')
  # LKG updater completeness gate requires dist/ in baseline ZIPs.
  # dist/ remains gitignored and excluded from source hygiene, but it must be present in operator handoff archives.
  return true if parts.include?('reports')
  return true if parts.include?('.git') && !include_git
  return true if parts[0, 3] == ['artifacts', 'validation', 'runtime']
  basename = File.basename(rel)
  return true if basename == '.DS_Store'
  return true if basename == '.env' || basename.start_with?('.env.')
  return true if File.extname(rel) == '.zip' || File.extname(rel) == '.log'
  false
end

def dos_time_date(mtime)
  t = mtime.localtime
  year = [[t.year, 1980].max, 2107].min
  dos_time = (t.hour << 11) | (t.min << 5) | (t.sec / 2)
  dos_date = ((year - 1980) << 9) | (t.month << 5) | t.day
  [dos_time, dos_date]
end

files = []
Find.find(root) do |path|
  rel_from_root = path.sub(/^#{Regexp.escape(root)}\/?/, '')
  next if rel_from_root.empty?
  rel_zip = File.join(base, rel_from_root).tr('\\', '/')
  if File.directory?(path)
    if exclude_file.call(rel_zip)
      Find.prune
    end
    next
  end
  next unless File.file?(path)
  next if exclude_file.call(rel_zip)
  files << [path, rel_zip]
end

File.open(zip_path, 'wb') do |zip|
  central = []
  files.each do |path, name|
    data = File.binread(path)
    crc = Zlib.crc32(data)
    size = data.bytesize
    stat = File.stat(path)
    dostime, dosdate = dos_time_date(stat.mtime)
    name_bin = name.encode('UTF-8')
    offset = zip.pos
    zip.write [0x04034b50, 20, 0x0800, 0, dostime, dosdate, crc, size, size, name_bin.bytesize, 0].pack('VvvvvvVVVvv')
    zip.write name_bin
    zip.write data
    mode = stat.mode & 0o777
    external_attr = (mode << 16)
    central << [name_bin, crc, size, dostime, dosdate, offset, external_attr]
  end
  central_start = zip.pos
  central.each do |name_bin, crc, size, dostime, dosdate, offset, external_attr|
    zip.write [0x02014b50, 0x031e, 20, 0x0800, 0, dostime, dosdate, crc, size, size, name_bin.bytesize, 0, 0, 0, 0, external_attr, offset].pack('VvvvvvvVVVvvvvvVV')
    zip.write name_bin
  end
  central_size = zip.pos - central_start
  count = central.length
  zip.write [0x06054b50, 0, 0, count, count, central_size, central_start, 0].pack('VvvvvVVv')
end

puts "Stored #{files.length} files in #{zip_path}"

STDOUT.flush
exit! 0
