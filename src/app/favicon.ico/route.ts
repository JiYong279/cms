import { NextResponse } from "next/server";

/**
 * Browsers ask for /favicon.ico on their own, whatever the page links to: send them to the app
 * icon (src/app/icon.png) instead of answering 404.
 */
export function GET(request: Request) {
  return NextResponse.redirect(new URL("/icon.png", request.url), 308);
}
