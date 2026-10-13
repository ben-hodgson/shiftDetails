# Docker Deployment for Unraid

This guide will help you deploy Shift Details in Unraid using the Docker Compose template or the "Add Container" feature.

## Quick Start - Using Prebuilt Image from GHCR (Recommended)

The easiest way for Unraid is to use the prebuilt image from GitHub Container Registry. A GitHub Actions workflow will automatically build and publish new images on pushes to `main`.

### Using docker-compose (Unraid 6.9+)

1. On your Unraid server, create a directory for the app (e.g., `/mnt/user/appdata/shiftdetails/`)
2. Download/copy `docker-compose.ghcr.yml` to that directory and rename it to `docker-compose.yml`
3. In Unraid WebUI, go to **Docker > Docker Compose**
4. Create a new stack pointing to that directory, or paste the contents
5. Deploy the stack

The provided `docker-compose.ghcr.yml` uses: `ghcr.io/ben-hodgson/shiftdetails:main`

### Using "Add Container" in Unraid WebUI

1. Go to **Docker > Add Container**
2. Set:
- **Name**: `shiftdetails`
- **Repository**: `ghcr.io/ben-hodgson/shiftdetails:main`
- **Network Type**: `bridge` (default)
- **Privileged**: `No`

**Ports**:
- Host Port: `5000`, Container Port: `5000`, TCP

**Volumes**:
- Host Path: `/mnt/user/appdata/shiftdetails/data`
- Container Path: `/app/data`
- Access Mode: `Read/Write`

**Environment Variables**:
- Key: `DB_PATH`, Value: `/app/data/shift_details.db`
- Key: `DATA_DIR`, Value: `/app/data`
- Key: `FLASK_ENV`, Value: `production` (optional)

**Environment** (optional):
- `FLASK_ENV` = `production`
- `FLASK_HOST` = `0.0.0.0`

**Restart Policy**: `unless-stopped`

3. Click **Apply**

## Option 2: Build from Source

If you prefer to build locally (e.g., for modifications), use the original `docker-compose.yml` which uses `build: .` or follow the build instructions below.

## Data Persistence

The application stores its SQLite database (`shift_details.db`) and CSV files in the `/app/data` directory. Make sure to map this to a persistent location on Unraid (recommended: `/mnt/user/appdata/shiftdetails/data/`).

## First Run

On first launch, if `shift_details.db` doesn't exist, the app will automatically import from `shift_details_24-25.csv` in the data directory. This CSV is already included in the repository.

## Accessing the App

Once running, access the app at: `http://<unraid-ip>:5000`

## Updating

Since you're using the `:main` tag from GHCR, new builds will be published automatically on each push to main. To update on Unraid:
- **Docker Compose**: `docker compose pull && docker compose up -d` in the directory, or use the "Pull Latest" option in Unraid
- **Add Container**: Click "Check for Updates" or recreate the container
