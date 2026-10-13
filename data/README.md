# Data Directory

This directory is for your shift data.

## How to add data

1. The app starts with an empty database. You can upload CSV files through the web UI (Upload CSV button on the dashboard).
2. Alternatively, you can manually place a CSV file here and use `import_db.py` to populate the database.

## CSV Format

The CSV should be semicolon-separated (`;`) with the following header:
```
Date;Shift Start;Shift End;Time due to leave;Wait Time (minutes);First Drop Time;Last Drop Time;Amount of Drops;Shift Length (hours);Back at Store;Weight of Van (kg);Van Registration;Managers Name;Totes
```

Dates: `DD Mon YYYY` (e.g., `01 Jan 2024`)  
Times: `HH:MM` (24-hour format)

## Database

The SQLite database (`shift_details.db`) is created automatically and stored here. It is ignored by git.
