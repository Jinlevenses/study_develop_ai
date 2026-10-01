CREATE TABLE in_note (
  note_id TEXT PRIMARY KEY,
  ext TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(ext)),
  ext_v INTEGER NOT NULL DEFAULT 1
) STRICT;
