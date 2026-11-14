import { Schema, model as createModel } from "mongoose";

export interface IMessageOptOut {
	userId: string;
}

const schema = new Schema<IMessageOptOut>({
	userId: { type: String, required: true, unique: true },
});

export const MessageOptOut = createModel<IMessageOptOut>(
	"MessageOptOuts",
	schema,
);
