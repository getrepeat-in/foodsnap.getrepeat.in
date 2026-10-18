import mongoose from "mongoose";

const FoodImageSchema = new mongoose.Schema(
  {
    title: { type: String, required: true, trim: true },
    description: { type: String, default: "" },
    category: { type: String, default: "", index: true },
    sub_category: { type: String, default: "" },
    cuisine: { type: String, default: "" },
    food_type: { type: String, default: "", index: true },
    tags: { type: [String], default: [], index: true },
    key: { type: String, required: true },
  },
  {
    collection: "images",
    timestamps: true,
  }
);

export const FoodImage =
  mongoose.models.FoodImage ||
  mongoose.model("FoodImage", FoodImageSchema, "images");
