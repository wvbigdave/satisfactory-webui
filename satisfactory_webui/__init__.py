"""satisfactory_webui — LAN admin console for the Axtriss Satisfactory dedicated server.

Versioning scheme (SemVer; tracked in CHANGELOG.md):
  MAJOR — breaking data-model/deployment change. v1.0.0 reserved for
          "public-ready" (off-LAN auth implemented).
  MINOR — additive: new page, panel, verified data source, or field help.
  PATCH — fixes, parser tuning, docs.
__version__ is the single source of truth: served at GET /api/version and
rendered in every page footer. Bump it in the same commit as the change.
"""
__version__ = "0.6.2"
