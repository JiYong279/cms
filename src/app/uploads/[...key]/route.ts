import { readUpload } from "@/lib/storage";

// Public on purpose: the websites embed these images in published articles.
export async function GET(_request: Request, ctx: RouteContext<"/uploads/[...key]">) {
  const { key } = await ctx.params;
  const file = await readUpload(key.join("/"));
  if (!file) return new Response("Not found", { status: 404 });

  return new Response(new Uint8Array(file.body), {
    headers: {
      "Content-Type": file.contentType,
      // Keys contain a random suffix and are never overwritten.
      "Cache-Control": "public, max-age=31536000, immutable",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
