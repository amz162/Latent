import { NextResponse } from "next/server";
import { getSignalById } from "@/lib/latent/mock-signals";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const signal = getSignalById(id);
  if (!signal) {
    return NextResponse.json({ error: "Signal not found" }, { status: 404 });
  }
  return NextResponse.json({ signal });
}
