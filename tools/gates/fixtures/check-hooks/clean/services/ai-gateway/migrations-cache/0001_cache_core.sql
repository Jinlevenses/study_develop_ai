CREATE TABLE ac_entry (
  entry_key TEXT PRIMARY KEY,
  ext TEXT NOT NULL DEFAULT '{}',
  ext_v INTEGER NOT NULL DEFAULT 1,
  CHECK (json_valid(ext))
) STRICT;
