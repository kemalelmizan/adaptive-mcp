---
"@adaptivemcp/extension": minor
---

Add tools-metadata SEP-2133 fixes to the extension package:

- `ToolsMetadataDocument` now includes an `etag` field (SHA-1 over the meaningful
  content, excluding the volatile `generated_at`) so clients can detect an
  unchanged view without re-parsing.
- `toDocument(doc, mimeType)` serializes the view as YAML (default) or JSON via
  content negotiation; `controller.resourceText(mimeType)` now accepts a MIME type.
- `ExtensionController.reportObservationTool()` exposes the spec-legal
  `report_observation` client→server tool definition (the preferred observation
  channel; `notifications/message` is intentionally not used).
- YAML rendering uses the safe `yaml.JSON_SCHEMA` to avoid deserialization hazards.
