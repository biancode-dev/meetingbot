// app/api/send-bot/route.ts
import { NextResponse } from 'next/server';

// Handle CORS preflight requests
export async function OPTIONS(req: Request) {
  return new NextResponse(null, {
    status: 200,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization, x-api-key',
      'Access-Control-Max-Age': '86400',
    },
  });
}

export async function POST(req: Request) {
  try {
    const body = await req.json();

    // Get Key
    const key = process.env.BOT_API_KEY;
    if (!key) throw new Error(`Missing required environment variable: BOT_API_KEY`);
    
    const endpoint = process.env.MEETINGBOT_END_POINT;
    if (!endpoint) throw new Error(`Missing required environment variable: MEETINGBOT_END_POINT`);

    //
    // Send request to MeetingBot API to start and send a bot to a meeting
    //
    const eurl = `${endpoint}/api/bots`;
    console.log('Sending Request to', eurl ,'with body', body);

    //Send
    const response = await fetch(eurl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': key,
      },
      body: JSON.stringify(body),   
    });

    //
    // Return the response from the MeetingBot API
    //

    const data = await response.json();
    console.log('RECEIVED', data);
    
    const nextResponse = NextResponse.json(data, { status: response.status });
    nextResponse.headers.set('Access-Control-Allow-Origin', '*');
    nextResponse.headers.set('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    nextResponse.headers.set('Access-Control-Allow-Headers', 'Content-Type, Authorization, x-api-key');
    
    return nextResponse;
  } catch (error) {
    console.error('Error:', error);
    
    const errorResponse = NextResponse.json({ error: error instanceof Error ? error.message : 'An unknown error occurred' }, { status: 500 });
    errorResponse.headers.set('Access-Control-Allow-Origin', '*');
    errorResponse.headers.set('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    errorResponse.headers.set('Access-Control-Allow-Headers', 'Content-Type, Authorization, x-api-key');
    
    return errorResponse;
  }
}
