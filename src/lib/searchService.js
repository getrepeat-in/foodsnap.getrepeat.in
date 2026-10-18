import { connectToDatabase } from "./mongodb";
import { FoodImage } from "../models/FoodImage";

const S3_BASE_URL =
  process.env.IMAGE_BASE_URL ||
  "https://getrepeat.s3.ap-south-1.amazonaws.com";

export function formatImageUrl(key) {
  if (!key) return "";
  if (key.startsWith("http://") || key.startsWith("https://")) return key;
  const cleanKey = key.replace(/^\/+/, "");
  return `${S3_BASE_URL}/${cleanKey}`;
}

function escapeRegex(text) {
  return String(text).replace(/[-[\]{}()*+?.,\\^$|#\s]/g, "\\$&");
}

export async function searchFoodImages(options = {}) {
  const startTime = Date.now();
  await connectToDatabase();

  const rawQuery = (options.query || "").trim();
  const page = Math.max(1, Number(options.page) || 1);
  const limit = Math.min(50, Math.max(1, Number(options.limit) || 12));
  const skip = (page - 1) * limit;

  const food_type = options.food_type?.trim() || null;
  const category = options.category?.trim() || null;
  const cuisine = options.cuisine?.trim() || null;

  // Base filter for extra facets (food_type, category, cuisine)
  const additionalFilters = {};
  if (food_type) {
    additionalFilters.food_type = { $regex: `^${escapeRegex(food_type)}$`, $options: "i" };
  }
  if (category) {
    additionalFilters.category = { $regex: escapeRegex(category), $options: "i" };
  }
  if (cuisine) {
    additionalFilters.cuisine = { $regex: escapeRegex(cuisine), $options: "i" };
  }

  // --- CASE 1: No text search query (Catalog Browse) ---
  if (!rawQuery) {
    const filter = { ...additionalFilters };
    const sortOption =
      options.sort === "title_desc"
        ? { title: -1 }
        : options.sort === "newest"
        ? { _id: -1 }
        : { title: 1 };

    const [total, docs] = await Promise.all([
      FoodImage.countDocuments(filter),
      FoodImage.find(filter)
        .sort(sortOption)
        .skip(skip)
        .limit(limit)
        .lean(),
    ]);

    const totalPages = Math.ceil(total / limit) || 1;
    const formattedData = docs.map((doc) => ({
      id: String(doc._id),
      title: doc.title || "",
      description: doc.description || "",
      category: doc.category || "",
      sub_category: doc.sub_category || "",
      cuisine: doc.cuisine || "",
      food_type: doc.food_type || "",
      tags: Array.isArray(doc.tags) ? doc.tags : [],
      key: doc.key || "",
      imageUrl: formatImageUrl(doc.key || ""),
    }));

    return {
      success: true,
      data: formattedData,
      pagination: {
        total,
        page,
        limit,
        totalPages,
        hasNextPage: page < totalPages,
        hasPrevPage: page > 1,
      },
      filters: {
        query: "",
        food_type,
        category,
        cuisine,
      },
      meta: {
        tookMs: Date.now() - startTime,
        strategy: "catalog_browse",
      },
    };
  }

  // --- CASE 2: Text Search with Relevance Ranking ---
  const lowerQuery = rawQuery.toLowerCase();

  const textMatch = {
    $text: { $search: rawQuery },
    ...additionalFilters,
  };

  const textPipeline = [
    { $match: textMatch },
    {
      $addFields: {
        textScore: { $meta: "textScore" },
        lowerTitle: { $toLower: "$title" },
      },
    },
    {
      $addFields: {
        isExactTitle: { $cond: [{ $eq: ["$lowerTitle", lowerQuery] }, 1, 0] },
        startsWithQuery: {
          $cond: [
            { $eq: [{ $indexOfCP: ["$lowerTitle", lowerQuery] }, 0] },
            1,
            0,
          ],
        },
        containsQuery: {
          $cond: [
            { $gt: [{ $indexOfCP: ["$lowerTitle", lowerQuery] }, -1] },
            1,
            0,
          ],
        },
        titleLength: { $strLenCP: { $ifNull: ["$title", ""] } },
      },
    },
    {
      $addFields: {
        relevanceScore: {
          $add: [
            { $multiply: ["$isExactTitle", 5000] },
            { $multiply: ["$startsWithQuery", 2500] },
            { $multiply: ["$containsQuery", 1000] },
            { $ifNull: [{ $multiply: ["$textScore", 15] }, 0] },
            { $max: [0, { $subtract: [100, "$titleLength"] }] },
          ],
        },
      },
    },
    { $sort: { relevanceScore: -1, _id: 1 } },
    {
      $facet: {
        metadata: [{ $count: "total" }],
        data: [{ $skip: skip }, { $limit: limit }],
      },
    },
  ];

  const [textResult] = await FoodImage.aggregate(textPipeline);
  const textTotal = textResult?.metadata[0]?.total || 0;
  const textData = textResult?.data || [];

  if (textTotal > 0) {
    const totalPages = Math.ceil(textTotal / limit) || 1;
    const formattedData = textData.map((doc) => ({
      id: String(doc._id),
      title: doc.title || "",
      description: doc.description || "",
      category: doc.category || "",
      sub_category: doc.sub_category || "",
      cuisine: doc.cuisine || "",
      food_type: doc.food_type || "",
      tags: Array.isArray(doc.tags) ? doc.tags : [],
      key: doc.key || "",
      imageUrl: formatImageUrl(doc.key || ""),
      relevanceScore: Math.round(doc.relevanceScore || 0),
    }));

    return {
      success: true,
      data: formattedData,
      pagination: {
        total: textTotal,
        page,
        limit,
        totalPages,
        hasNextPage: page < totalPages,
        hasPrevPage: page > 1,
      },
      filters: {
        query: rawQuery,
        food_type,
        category,
        cuisine,
      },
      meta: {
        tookMs: Date.now() - startTime,
        strategy: "text_search",
      },
    };
  }

  // --- CASE 3: Seamless Regex Fallback (e.g. partial prefix "burg", "biry", "mom") ---
  const escaped = escapeRegex(rawQuery);
  const regexMatch = {
    $or: [
      { title: { $regex: `\\b${escaped}`, $options: "i" } },
      { title: { $regex: escaped, $options: "i" } },
      { tags: { $regex: `^${escaped}`, $options: "i" } },
      { category: { $regex: escaped, $options: "i" } },
    ],
    ...additionalFilters,
  };

  const regexPipeline = [
    { $match: regexMatch },
    {
      $addFields: {
        lowerTitle: { $toLower: "$title" },
        titleLength: { $strLenCP: { $ifNull: ["$title", ""] } },
      },
    },
    {
      $addFields: {
        isExactTitle: { $cond: [{ $eq: ["$lowerTitle", lowerQuery] }, 1, 0] },
        startsWithQuery: {
          $cond: [
            { $eq: [{ $indexOfCP: ["$lowerTitle", lowerQuery] }, 0] },
            1,
            0,
          ],
        },
        containsQuery: {
          $cond: [
            { $gt: [{ $indexOfCP: ["$lowerTitle", lowerQuery] }, -1] },
            1,
            0,
          ],
        },
      },
    },
    {
      $addFields: {
        relevanceScore: {
          $add: [
            { $multiply: ["$isExactTitle", 5000] },
            { $multiply: ["$startsWithQuery", 2500] },
            { $multiply: ["$containsQuery", 1200] },
            { $max: [0, { $subtract: [100, "$titleLength"] }] },
          ],
        },
      },
    },
    { $sort: { relevanceScore: -1, _id: 1 } },
    {
      $facet: {
        metadata: [{ $count: "total" }],
        data: [{ $skip: skip }, { $limit: limit }],
      },
    },
  ];

  const [regexResult] = await FoodImage.aggregate(regexPipeline);
  const regexTotal = regexResult?.metadata[0]?.total || 0;
  const regexData = regexResult?.data || [];

  const totalPages = Math.ceil(regexTotal / limit) || 1;
  const formattedData = regexData.map((doc) => ({
    id: String(doc._id),
    title: doc.title || "",
    description: doc.description || "",
    category: doc.category || "",
    sub_category: doc.sub_category || "",
    cuisine: doc.cuisine || "",
    food_type: doc.food_type || "",
    tags: Array.isArray(doc.tags) ? doc.tags : [],
    key: doc.key || "",
    imageUrl: formatImageUrl(doc.key || ""),
    relevanceScore: Math.round(doc.relevanceScore || 0),
  }));

  return {
    success: true,
    data: formattedData,
    pagination: {
      total: regexTotal,
      page,
      limit,
      totalPages,
      hasNextPage: page < totalPages,
      hasPrevPage: page > 1,
    },
    filters: {
      query: rawQuery,
      food_type,
      category,
      cuisine,
    },
    meta: {
      tookMs: Date.now() - startTime,
      strategy: "regex_fallback",
    },
  };
}
