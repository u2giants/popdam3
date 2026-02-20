\# WORKER LOGIC: The "Muscle" Strategy



This document defines how the Bridge Agent must handle heavy PSD/AI processing on the Synology NAS to avoid memory crashes and silent errors.



\## 1. Batch Processing \& Ingestion

\- \*\*Batch Size:\*\* Process and ingest assets in batches of \*\*100 files\*\*.

\- \*\*Checkpointing:\*\* Save the "last scanned" state only after a batch is successfully acknowledged by the Cloud API.

\- \*\*Concurrency:\*\* Limit thumbnail generation to \*\*2 simultaneous processes\*\* to prevent CPU spikes on the NAS.



\## 2. PSD Thumbnail Fallback Chain

PSD files can be multi-gigabyte. The worker must use this fallback order to save time and memory:

1\. \*\*Embedded Preview:\*\* Attempt to extract the "Composite Image" already saved inside the PSD (using `ag-psd` or similar).

2\. \*\*Tiled Rendering:\*\* If no preview exists, use a library that supports "tiled reading" to avoid loading the whole 2GB file into RAM.

3\. \*\*Ghostscript/ImageMagick:\*\* Last resort for legacy files. If this fails, set `thumbnail\_error = 'render\_queued'` for the Windows Agent.



\## 3. High-Performance Uploads

\- \*\*Cache-Control:\*\* All thumbnails uploaded to DigitalOcean Spaces MUST be set with `Cache-Control: public, max-age=31536000, immutable`.

\- \*\*CDN:\*\* Use the DigitalOcean CDN endpoint for all UI requests to ensure "snappy" gallery loading.



\## 4. Stability Guardrails

\- \*\*Symlink Prevention:\*\* The scanner MUST NOT follow symbolic links to avoid infinite directory loops.

\- \*\*Heartbeat:\*\* The worker must send a heartbeat every \*\*30 seconds\*\*. If the cloud misses 3 heartbeats, it flags the NAS as "Offline" in the UI.

