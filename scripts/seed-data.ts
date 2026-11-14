import type { PaletteColor } from "@/lib/constants";

export interface SeedProject {
  name: string;
  code: string;
  description: string;
  color: PaletteColor;
  tasks: string[];
}

export interface SeedDepartment {
  name: string;
  code: string;
  description: string;
  color: PaletteColor;
  manager: string;
  /** Each lead with the developers who report to them. */
  teams: { lead: string; developers: string[] }[];
  projects: SeedProject[];
}

export const SEED_CEO = "Layla Haddad";

// Demo logins are derived from this data: see the README.
export const SEED_DEPARTMENTS: SeedDepartment[] = [
  {
    name: "IT",
    code: "IT",
    description: "Builds and runs the company's internal and client-facing software.",
    color: "teal",
    manager: "Omar Farouk",
    teams: [
      { lead: "Priya Nair", developers: ["Arjun Mehta", "Sara Khalil"] },
      { lead: "Daniel Osei", developers: ["Lina Yusuf", "Tomás Rivera"] },
    ],
    projects: [
      {
        name: "Client Portal",
        code: "PORTAL",
        description: "Self-service portal for client documents and invoices.",
        color: "teal",
        tasks: [
          "Built the document upload screen and connected it to the storage API.",
          "Fixed session timeout handling on the invoice download page.",
          "Reviewed and merged the pull request for portal notification settings.",
          "Added pagination to the client document list.",
          "Wrote integration tests for the invoice approval endpoint.",
        ],
      },
      {
        name: "Payments Migration",
        code: "PAY",
        description: "Moves payment processing from the legacy gateway to the new provider.",
        color: "violet",
        tasks: [
          "Mapped legacy transaction statuses to the new provider's status model.",
          "Ran a reconciliation of October test transactions and logged the differences.",
          "Implemented webhook signature verification for payment callbacks.",
          "Waiting on provider sandbox credentials to test refund flows.",
          "Paired on retry logic for failed settlement jobs.",
        ],
      },
      {
        name: "Infrastructure Upkeep",
        code: "INFRA",
        description: "Patching, monitoring and backup checks across environments.",
        color: "slate",
        tasks: [
          "Applied security patches to the staging database hosts.",
          "Tuned the API latency alert thresholds and removed noisy rules.",
          "Verified last week's backup restore in the recovery environment.",
          "Rotated expiring service credentials across environments.",
        ],
      },
    ],
  },
  {
    name: "HR",
    code: "HR",
    description: "Recruitment, onboarding and employee relations.",
    color: "coral",
    manager: "Mariam Saleh",
    teams: [{ lead: "Grace Mensah", developers: ["Hassan Ali", "Nadia Rahman"] }],
    projects: [
      {
        name: "Q4 Hiring",
        code: "HIRE",
        description: "Fills the open roles approved for the fourth quarter.",
        color: "coral",
        tasks: [
          "Screened applications for the senior accountant role and shortlisted candidates.",
          "Held first-round interviews and recorded the panel's feedback.",
          "Prepared offer letters for two approved candidates.",
          "Waiting on a hiring manager's decision for the analyst shortlist.",
        ],
      },
      {
        name: "Onboarding Refresh",
        code: "ONBD",
        description: "Redesigns the first-month experience for new joiners.",
        color: "pink",
        tasks: [
          "Updated the first-week onboarding checklist with IT access steps.",
          "Ran the orientation session for this month's new joiners.",
          "Collected 30-day feedback from recent hires and summarised the themes.",
        ],
      },
    ],
  },
  {
    name: "Advisory",
    code: "ADV",
    description: "Client engagements, due diligence and strategic reviews.",
    color: "indigo",
    manager: "Yusuf Demir",
    teams: [
      { lead: "Elena Petrova", developers: ["Khalid Noor", "Aisha Karim", "Ben Carter"] },
    ],
    projects: [
      {
        name: "Market Entry Study",
        code: "MES",
        description: "Assesses regional market entry options for a retail client.",
        color: "indigo",
        tasks: [
          "Compiled competitor pricing data for the regional retail market.",
          "Drafted the regulatory overview section of the market entry report.",
          "Interviewed two distribution partners and documented the findings.",
          "Waiting on the client's sales data before finishing the demand model.",
        ],
      },
      {
        name: "Due Diligence Review",
        code: "DDR",
        description: "Financial and operational review for a pending acquisition.",
        color: "sky",
        tasks: [
          "Reviewed the target's three-year financial statements and flagged anomalies.",
          "Prepared the management interview question list.",
          "Updated the risk register after the operations site visit.",
        ],
      },
      {
        name: "Strategy Workshops",
        code: "WKSP",
        description: "Facilitated planning workshops for leadership teams.",
        color: "orange",
        tasks: [
          "Prepared the workshop agenda and pre-read for the client's leadership team.",
          "Facilitated the half-day planning workshop and captured the action items.",
          "Wrote the post-workshop summary and sent it for partner review.",
        ],
      },
    ],
  },
  {
    name: "Accounts",
    code: "ACC",
    description: "Bookkeeping, reporting and accounts payable and receivable.",
    color: "lime",
    manager: "Fatima Zahra",
    teams: [{ lead: "Rashid Anwar", developers: ["Joseph Thomas", "Mona Adel"] }],
    projects: [
      {
        name: "Month-End Close",
        code: "CLOSE",
        description: "Monthly reconciliations, accruals and reporting pack.",
        color: "lime",
        tasks: [
          "Reconciled the main operating bank accounts for the month.",
          "Posted accruals and reviewed the variance against budget.",
          "Prepared the management reporting pack for the close meeting.",
          "Waiting on two departments' expense confirmations to finish accruals.",
        ],
      },
      {
        name: "Vendor Payments",
        code: "VEND",
        description: "Invoice processing and scheduled vendor payment runs.",
        color: "yellow",
        tasks: [
          "Processed the week's vendor invoices and matched them to purchase orders.",
          "Resolved duplicate invoice queries with three suppliers.",
          "Prepared and submitted the scheduled payment run for approval.",
        ],
      },
    ],
  },
  {
    name: "Marketing",
    code: "MKT",
    description: "Brand, campaigns, content and events.",
    color: "pink",
    manager: "Sofia Laurent",
    teams: [{ lead: "Imran Sheikh", developers: ["Chloe Martin", "Rami Aziz"] }],
    projects: [
      {
        name: "Autumn Campaign",
        code: "AUT",
        description: "Multi-channel lead generation campaign for the autumn quarter.",
        color: "orange",
        tasks: [
          "Drafted the campaign landing page copy and sent it for review.",
          "Scheduled the first round of paid social creatives.",
          "Analysed week-one campaign performance and adjusted the audience targeting.",
          "Waiting on final legal approval for the campaign's offer terms.",
        ],
      },
      {
        name: "Website Content",
        code: "WEB",
        description: "Keeps the public website's service pages and blog current.",
        color: "sky",
        tasks: [
          "Published the new services page after editing and SEO review.",
          "Wrote a client case study draft from the interview notes.",
          "Updated meta descriptions across the top twenty pages.",
        ],
      },
      {
        name: "Annual Summit",
        code: "SUMMIT",
        description: "Planning for the company's annual client summit.",
        color: "violet",
        tasks: [
          "Confirmed the venue contract and shared the floor plan with the team.",
          "Sent speaker invitations and tracked the responses.",
          "Designed the event registration page with the agency.",
        ],
      },
    ],
  },
];
