import { model, models, Schema, type Model } from "mongoose";

export interface IRateLimit {
  _id: string;
  count: number;
  expiresAt: Date;
}

const rateLimitSchema = new Schema<IRateLimit>({
  _id: { type: String, required: true },
  count: { type: Number, required: true },
  expiresAt: { type: Date, required: true },
});

rateLimitSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export const RateLimit =
  (models.RateLimit as Model<IRateLimit>) || model<IRateLimit>("RateLimit", rateLimitSchema);
