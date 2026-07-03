const CALENDAR_API = 'https://www.googleapis.com/calendar/v3';

// Returns true if there's a conflicting event in the given UTC window.
export async function checkFreeBusy({ accessToken, calendarId, startUTC, endUTC }) {
  const response = await fetch(`${CALENDAR_API}/freeBusy`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ timeMin: startUTC, timeMax: endUTC, items: [{ id: calendarId }] })
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Google freeBusy check failed (${response.status}): ${errText}`);
  }

  const data = await response.json();
  const busy = data.calendars?.[calendarId]?.busy ?? [];
  return busy.length > 0;
}

export async function createEvent({ accessToken, calendarId, summary, description, startUTC, endUTC }) {
  const response = await fetch(`${CALENDAR_API}/calendars/${encodeURIComponent(calendarId)}/events`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      summary,
      description,
      start: { dateTime: startUTC },
      end: { dateTime: endUTC }
    })
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Google event creation failed (${response.status}): ${errText}`);
  }

  const data = await response.json();
  return { eventId: data.id };
}
