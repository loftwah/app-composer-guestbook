// Generated from checked TypeScript; edit src/browser or src/publisher.mts. MIT.
import { validateContentModel, validateModelValues, } from "./enquiry-model-validator.js";
export const enquiryModelVersion = 1;
export const enquiryBodyLimit = 12288;
// One declared model, never a schema supplied by a visitor.
const model = validateContentModel({
    schema: "app-composer.content-model",
    version: 1,
    collection: "enquiries",
    label: "Project enquiries",
    groups: ["The brief", "What is needed"],
    fields: [
        {
            key: "title",
            label: "Project or enquiry name",
            type: "string",
            required: true,
            group: "The brief",
            validation: {
                maxLength: 120,
            },
        },
        {
            key: "goal",
            label: "What should this achieve?",
            type: "text",
            required: true,
            group: "The brief",
            validation: {
                maxLength: 2000,
            },
        },
        {
            key: "starting_point",
            label: "Starting point",
            type: "select",
            required: true,
            group: "The brief",
            choices: ["New idea", "Existing site"],
        },
        {
            key: "existing_site",
            label: "Existing website",
            type: "url",
            required: false,
            group: "The brief",
            when: {
                field: "starting_point",
                equals: "Existing site",
            },
        },
        {
            key: "deliverables",
            label: "Requested deliverables",
            type: "repeater",
            required: false,
            group: "What is needed",
            limit: 8,
            fields: [
                {
                    key: "item",
                    label: "Deliverable",
                    type: "string",
                    required: true,
                },
                {
                    key: "detail",
                    label: "Useful detail",
                    type: "text",
                    required: false,
                },
            ],
        },
    ],
});
export const enquiryRowLimits = Object.freeze({ item: 120, detail: 300 });
export function enquiryModel() {
    return validateContentModel(model);
}
export function enquiryValues(value) {
    const clean = validateModelValues(model, value);
    if (typeof clean.existing_site === "string" &&
        clean.existing_site.length > 240)
        throw Error("Use an HTTPS address within 240 characters after URL normalization.");
    // The captured general model does not support custom nested limits. These
    // declared private-delivery admission bounds are shared with the actual form.
    for (const row of clean.deliverables) {
        for (const key of ["item", "detail"]) {
            const text = row[key];
            if (typeof text === "string" && text.length > enquiryRowLimits[key]) {
                throw Error("Each deliverable " +
                    key +
                    " supports at most " +
                    enquiryRowLimits[key] +
                    " characters.");
            }
        }
    }
    return clean;
}
