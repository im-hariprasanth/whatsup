const GRAPH_API_VERSION = 'v20.0';

// Sends a text reply via Meta's Graph API using the tenant's own token and
// phone_number_id (its WhatsApp Business number), so every clinic sends as itself.
export async function sendReply(tenant, patientPhone, text) {
  const url = `https://graph.facebook.com/${GRAPH_API_VERSION}/${tenant.phoneNumberId}/messages`;

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${tenant.metaToken}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      messaging_product: 'whatsapp',
      to: patientPhone,
      type: 'text',
      text: { body: text }
    })
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`WhatsApp send failed (${response.status}): ${errText}`);
  }

  const result = await response.json();
  console.log(`[whatsapp:sent] to=${patientPhone} clinic=${tenant.clinicId}`, JSON.stringify(result));
  return result;
}
