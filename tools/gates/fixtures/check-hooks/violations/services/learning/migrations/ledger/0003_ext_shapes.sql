CREATE TABLE lr_noext ( -- EXPECT[hooks/ext-missing]
  id TEXT PRIMARY KEY
) STRICT;
CREATE TABLE lr_nodefault ( -- EXPECT[hooks/ext-shape]
  id TEXT PRIMARY KEY,
  ext TEXT NOT NULL CHECK (json_valid(ext)),
  ext_v INTEGER NOT NULL DEFAULT 1
) STRICT;
CREATE TABLE lr_nocheck ( -- EXPECT[hooks/ext-shape]
  id TEXT PRIMARY KEY,
  ext TEXT NOT NULL DEFAULT '{}',
  ext_v INTEGER NOT NULL DEFAULT 1
) STRICT;
CREATE TABLE lr_badextv ( -- EXPECT[hooks/ext-shape]
  id TEXT PRIMARY KEY,
  ext TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(ext)),
  ext_v INTEGER NOT NULL DEFAULT 0
) STRICT;
