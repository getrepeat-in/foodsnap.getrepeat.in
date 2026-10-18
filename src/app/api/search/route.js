import { NextResponse } from "next/server";
import { searchFoodImages } from "@/lib/searchService";

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);

    const query = searchParams.get("q") ?? searchParams.get("query") ?? undefined;
    const page = searchParams.get("page") ? parseInt(searchParams.get("page"), 10) : 1;
    const limit = searchParams.get("limit") ? parseInt(searchParams.get("limit"), 10) : 12;
    const food_type = searchParams.get("food_type") ?? searchParams.get("foodType") ?? undefined;
    const category = searchParams.get("category") ?? undefined;
    const cuisine = searchParams.get("cuisine") ?? undefined;
    const sort = searchParams.get("sort") ?? undefined;

    const result = await searchFoodImages({
      query,
      page,
      limit,
      food_type,
      category,
      cuisine,
      sort,
    });

    return NextResponse.json(result, {
      status: 200,
      headers: {
        "Cache-Control": "public, s-maxage=60, stale-while-revalidate=300",
      },
    });
  } catch (error) {
    console.error("Search API Error:", error);
    return NextResponse.json(
      {
        success: false,
        error: error.message || "Internal server error during search",
      },
      { status: 500 }
    );
  }
}

export async function POST(request) {
  try {
    const body = await request.json().catch(() => ({}));

    const query = body.q ?? body.query ?? undefined;
    const page = body.page ? parseInt(body.page, 10) : 1;
    const limit = body.limit ? parseInt(body.limit, 10) : 12;
    const food_type = body.food_type ?? body.foodType ?? undefined;
    const category = body.category ?? undefined;
    const cuisine = body.cuisine ?? undefined;
    const sort = body.sort ?? undefined;

    const result = await searchFoodImages({
      query,
      page,
      limit,
      food_type,
      category,
      cuisine,
      sort,
    });

    return NextResponse.json(result, { status: 200 });
  } catch (error) {
    console.error("Search API Error:", error);
    return NextResponse.json(
      {
        success: false,
        error: error.message || "Internal server error during search",
      },
      { status: 500 }
    );
  }
}
