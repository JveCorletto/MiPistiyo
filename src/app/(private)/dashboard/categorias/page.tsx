import { Suspense } from "react";
import { connection } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { CategoryManager } from "./category-manager";

async function CategoriesContent() {
  await connection();
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("categories")
    .select("id,name,kind,color,is_active")
    .order("kind")
    .order("sort_order")
    .order("name");

  if (error) {
    return <p className="text-red-400">{error.message}</p>;
  }

  return <CategoryManager categories={data ?? []} />;
}

export default function CategoriesPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold">Categorías</h1>
        <p className="mt-2 text-slate-400">
          Organiza tus ingresos y gastos.
        </p>
      </div>
      <Suspense fallback={<p>Cargando categorías...</p>}>
        <CategoriesContent/>
      </Suspense>
    </div>
  );
}