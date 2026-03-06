

# Diagnosis: Broken Images in Alternative Images Scan

## Root Cause

The currently deployed Bridge Agent (`v1.0.0` / build `ca630c0`) was built **before** the sibling thumbnail upload code was added. The thumbnail generation code (sharp resize + upload to DO Spaces under `siblings/` prefix) exists in the codebase now but has never been deployed to the running Docker container on the Synology.

When the agent runs a sibling scan, it returns file metadata (filename, relative_path, file_size) but `thumbnail_url` is always `undefined`. The UI then renders the `ImageOff` placeholder icon for each file -- which appears as "broken images" since you can see the filenames but no visual preview.

## Why the files open fine on the server

The files physically exist on the NAS. The issue is not file access -- the agent successfully `stat()`s them and returns their metadata. The missing piece is that the agent never generates or uploads a thumbnail for these sibling images, so there is no URL for the browser to display.

## Fix: Two steps required

### Step 1: Rebuild and redeploy the Bridge Agent

The agent Docker image must be rebuilt to include the sibling thumbnail code. Trigger the **Publish Bridge Agent** GitHub Actions workflow, then update the container on Synology.

No code changes needed -- the code is already correct in the repo.

### Step 2: Re-scan affected groups

Cached sibling scan results (stored in `admin_config`) from before the rebuild will still lack `thumbnail_url`. After deploying the new agent, click "Re-scan Folder" on any group like VKP83NBMN01 to get fresh results with thumbnails.

## No code changes required

This is a deployment issue, not a code bug. The implementation is already in place.

