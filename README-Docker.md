# Docker Deployment for Unraid

This guide will help you deploy Shift Details in Unraid using the Docker Compose template or the "Add Container" feature.

## Quick Start - Using Docker Compose

If you have Docker Compose enabled in Unraid (or using Community Applications), you can use the `docker-compose.yml` file directly.

1. Clone or download this repository to your Unraid server (e.g., `/mnt/user/appdata/shiftdetails/`)
2. Navigate to that directory in a terminal
3. Run `docker compose up -d`

## Unraid "Add Container" Method

Unraid's web UI allows you to add containers directly. Since we have a `Dockerfile`, you can build from source.

### Option 1: Build from GitHub Repository

1. In Unraid WebUI, go to **Docker > Add Container**
2. Set the following:

**Repository**: `ben-hodgson/shiftdetails`  
**Build**: `Yes` (Unraid will build from Dockerfile)  
**Branch**: `main`

Or if you prefer to use the git URL directly:
**Repository**: `ghcr.io/ben-hodgson/shiftdetails` (if you push to GHCR) - Not set up yet. Better to build from source.

Alternatively, use the template fields:
- **Name**: `shiftdetails`
- **Repository**: `https://github.com/ben-hodgson/shiftDetails.git#main`
- **Build Context**: `.` (default)
- **Dockerfile**: `Dockerfile`

**Ports**:
- Host Port: `5000`
- Container Port: `5000` (TCP)

**Volumes**:
- Host Path: `/mnt/user/appdata/shiftdetails/data` (or any location on your array/cache)
- Container Path: `/app/data`
- Access Mode: `Read/Write`

**Environment Variables** (optional):
- `FLASK_ENV` = `production`
- `FLASK_HOST` = `0.0.0.0`

**Restart Policy**: `unless-stopped`

3. Click **Apply**

### Option 2: Use docker-compose.yml in Unraid

Unraid 6.9+ supports Docker Compose natively. You can:
1. Go to **Docker > Docker Compose**
2. Create a new stack, paste the contents of `docker-compose.yml`, and deploy

## Data Persistence

The application stores its SQLite database (`shift_details.db`) and CSV files in the `/app/data` directory. Make sure to map this to a persistent location on Unraid (recommended: `/mnt/user/appdata/shiftdetails/data/`).

## First Run

On first launch, if `shift_details.db` doesn't exist, the app will automatically import from `shift_details_24-25.csv` in the data directory. This CSV is already included in the repository.

## Accessing the App

Once running, access the app at: `http://<unraid-ip>:5000`

## Updating

If building from GitHub, you can just pull/rebuild the container in Unraid to get the latest changes.
