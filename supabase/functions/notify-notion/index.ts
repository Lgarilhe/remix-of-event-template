import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const NOTION_API_KEY = Deno.env.get("NOTION_API_KEY");
const NOTION_DATABASE_ID = "8eeb02fc-1c6b-4bf3-9877-c8a2acc2e604"; // Leads Landing Page database

interface ContactSubmission {
  name: string;
  email: string;
  company?: string;
  message: string;
}

async function createNotionPage(data: ContactSubmission) {
  const response = await fetch("https://api.notion.com/v1/pages", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${NOTION_API_KEY}`,
      "Content-Type": "application/json",
      "Notion-Version": "2022-06-28",
    },
    body: JSON.stringify({
      parent: { database_id: NOTION_DATABASE_ID },
      properties: {
        "Nom complet": {
          title: [{ text: { content: data.name } }],
        },
        "Email": {
          email: data.email,
        },
        "Entreprise": {
          rich_text: [{ text: { content: data.company || "" } }],
        },
        "Statut": {
          status: { name: "Nouveau" },
        },
      },
      children: [
        {
          object: "block",
          type: "heading_2",
          heading_2: {
            rich_text: [{ type: "text", text: { content: "Message" } }],
          },
        },
        {
          object: "block",
          type: "paragraph",
          paragraph: {
            rich_text: [{ type: "text", text: { content: data.message } }],
          },
        },
      ],
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    console.error("Notion API error:", error);
    throw new Error(`Failed to create Notion page: ${error}`);
  }

  return await response.json();
}

const handler = async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    if (!NOTION_API_KEY) {
      throw new Error("NOTION_API_KEY is not configured");
    }

    const { name, email, company, message }: ContactSubmission = await req.json();

    if (!name || !email || !message) {
      return new Response(
        JSON.stringify({ error: "Missing required fields" }),
        { status: 400, headers: { "Content-Type": "application/json", ...corsHeaders } }
      );
    }

    console.log(`Creating Notion page for lead: ${name} (${email})`);
    
    const notionPage = await createNotionPage({ name, email, company, message });
    
    console.log("Notion page created successfully:", notionPage.id);

    return new Response(
      JSON.stringify({ success: true, notionPageId: notionPage.id }),
      { status: 200, headers: { "Content-Type": "application/json", ...corsHeaders } }
    );
  } catch (error: any) {
    console.error("Error in notify-notion function:", error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { "Content-Type": "application/json", ...corsHeaders } }
    );
  }
};

serve(handler);
