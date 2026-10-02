"use server";

import { createClient } from "@/lib/supabase/client";
import { getCurrentUser, type CurrentUserContext } from "@/modules/auth/infrastructure/auth-service";

/**
 * Returns the authenticated users context, or null when logged out.
 */
export async function getCurrentUserContext(): Promise<CurrentUserContext | null> {
  const supabase = await createClient();
  return getCurrentUser(supabase);
}
