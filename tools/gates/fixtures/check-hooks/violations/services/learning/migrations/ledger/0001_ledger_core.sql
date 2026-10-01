-- EXPECT[hooks/table-missing]
CREATE TABLE lr_event ( -- EXPECT[hooks/name-missing]
  event_id TEXT PRIMARY KEY,
  ext TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(ext)),
  ext_v INTEGER NOT NULL DEFAULT 1
) STRICT;
ALTER TABLE lr_event ADD COLUMN alter_col TEXT;
