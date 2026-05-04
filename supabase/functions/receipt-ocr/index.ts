// Supabase Edge Function stub for receipt OCR
// This is a minimal HTTP handler (Deno) that returns a stubbed parse result.
// Deploy via `supabase functions deploy receipt-ocr` after configuring your Supabase project.

export default async (req: Request) => {
  try {
    const body = await req.json().catch(() => ({}));
    const path = body.path || (new URL(req.url)).searchParams.get('path');
    if (!path) return new Response(JSON.stringify({ error: 'missing path' }), { status: 400 });

    // TODO: implement fetching the object via signed URL and call OCR (Textract or other)
    const parsedText = "Milk 1.20\nTomatoes 2.50\nTotal 3.70";
    const candidates = [
      { description: "Milk", price: 1.2 },
      { description: "Tomatoes", price: 2.5 }
    ];

    // Optionally: update Supabase receipts row using service_role key via REST API
    // NOTE: keep service_role key secret; set as environment variable for the function

    return new Response(JSON.stringify({ parsed_text: parsedText, candidates }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), { status: 500 });
  }
};

