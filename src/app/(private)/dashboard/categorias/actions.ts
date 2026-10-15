"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

export type CategoryState = {
  error: string | null;
  success: string | null;
};

export async function saveCategory(
  _previous: CategoryState,
  formData: FormData
): Promise<CategoryState> {
  const supabase = await createClient();

  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    return { error: "Sesión no válida.", success: null };
  }

  const id = String(formData.get("id") ?? "");
  const name = String(formData.get("name") ?? "").trim();
  const kind = String(formData.get("kind") ?? "");
  const color = String(formData.get("color") ?? "#10B981");

  if (!name || name.length > 100) {
    return { error: "Nombre inválido.", success: null };
  }

  if (!["INCOME", "EXPENSE"].includes(kind)) {
    return { error: "Tipo inválido.", success: null };
  }

  if (!/^#[0-9a-fA-F]{6}$/.test(color)) {
    return { error: "Color inválido.", success: null };
  }

  const result = id
    ? await supabase.from("categories")
        .update({ name, color })
        .eq("id", id)
        .eq("user_id", user.id)
        .select("id")
        .single()
    : await supabase.from("categories")
        .insert({ user_id: user.id, name, kind, color })
        .select("id")
        .single();

  if (result.error) {
    return {
      error: result.error.code === "23505"
        ? "Ya existe una categoría con ese nombre y tipo."
        : result.error.message,
      success: null,
    };
  }

  revalidatePath("/dashboard/categorias");
  revalidatePath("/dashboard/movimientos");

  return {
    error: null,
    success: id ? "Categoría actualizada." : "Categoría creada.",
  };
}

export async function toggleCategory(formData: FormData) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) throw new Error("Sesión no válida.");

  const id = String(formData.get("id") ?? "");
  const isActive = String(formData.get("active")) === "true";

  const { error } = await supabase.from("categories")
    .update({ is_active: !isActive })
    .eq("id", id)
    .eq("user_id", user.id);

  if (error) throw new Error(error.message);

  revalidatePath("/dashboard/categorias");
  revalidatePath("/dashboard/movimientos");
}

export async function seedCategories() {
  const supabase = await createClient();
  const { error } = await supabase.rpc("seed_default_categories");

  if (error) throw new Error(error.message);

  revalidatePath("/dashboard/categorias");
  revalidatePath("/dashboard/movimientos");
}