import { model, models, Schema, type Model, type Types } from "mongoose";

/**
 * A personal token for tools outside the browser, such as the VS Code daily sync. Only its
 * SHA-256 hash is stored; the token itself is shown once, when it's created.
 */
export interface IApiToken {
  _id: Types.ObjectId;
  userId: Types.ObjectId;
  name: string;
  tokenHash: string;
  /** The first characters of the token, so people can tell their tokens apart. */
  prefix: string;
  lastUsedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

const apiTokenSchema = new Schema<IApiToken>(
  {
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    name: { type: String, required: true, trim: true },
    tokenHash: { type: String, required: true, select: false },
    prefix: { type: String, required: true },
    lastUsedAt: { type: Date, default: null },
  },
  { timestamps: true },
);

apiTokenSchema.index({ tokenHash: 1 }, { unique: true });
apiTokenSchema.index({ userId: 1 });

export const ApiToken =
  (models.ApiToken as Model<IApiToken>) || model<IApiToken>("ApiToken", apiTokenSchema);
