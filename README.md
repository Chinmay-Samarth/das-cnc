# DAS CNC Attendance Platform

This repository contains a starter React PWA frontend and an Express.js backend connected to Supabase Postgres for an attendance system.

## Structure

- `client/` - React + Vite PWA frontend
- `server/` - Express API connected to Supabase

## Setup

1. Install dependencies:

```bash
npm install
```

2. Copy the server env example and configure Supabase:

```bash
cd server
copy .env.example .env
```

Update `.env` with your Supabase URL and service role key.

3. Run both services together:

```bash
npm run dev
```

The frontend will run on `http://localhost:5173` and proxy `/api` requests to the backend on `http://localhost:3000`.

## Supabase table

Create an `attendance` table in Supabase with columns like:

- `id` (int, primary key, auto-increment)
- `name` (text)
- `status` (text)
- `checked_at` (timestamp)

You can also add `notes` or `role` fields later.

## API Endpoints

- `GET /api/attendance` - list attendance records
- `POST /api/attendance` - add a new attendance record
- `GET /api/attendance/:id` - fetch one record

## Notes

- The backend uses the Supabase JS client.
- The frontend registers a service worker for basic offline caching.


{
  "device_id":"GATE-01",
  "biometric_ref":"FP-1001",
  "event_type":"CHECK_OUT",
  "captured_at":"2026-05-31T05:45:00",
}