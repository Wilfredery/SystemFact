"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { logout } from "@/modules/auth/infrastructure/auth-service";

/**
 * Closes the current session and redirects to the login page.
 */
export async function logoutAction(): Promise<void> {
  const supabase = await createClient();
  await logout(supabase);
  redirect("/login");
}
