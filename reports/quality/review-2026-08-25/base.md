Review the supplied naia-memory research changes adversarially. Return one JSON
object with `verdict` (`CLEAN` or `NOT_CLEAN`), `coverage`, and `findings`.
`coverage` must contain every ledger atom exactly once as
`{"atom_id":"...","status":"COVERED|NOT_COVERED"}`. Each finding must use
`{"atom_id":"...","file_location":"...","impact":"...","minimal_fix":"..."}`.
`CLEAN` requires every atom to be `COVERED` and `findings` to be empty. Output
JSON only and do not modify files. Inspect only files named in reviewer-delta.md.
