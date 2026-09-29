import type { SqlLimits, SqlSampleData, SqlTableSchema, SqlTask } from "../types";

/**
 * Curated SQL tasks over the synthetic "retail_v1" dataset
 * (sandbox-runner/datasets/retail_v1.sql). Each task runs in its own isolated
 * sandbox database. Expected results stay on the server; candidate queries are
 * graded by comparing result datasets, never SQL text.
 *
 * Expected rows were produced by reference queries against the dataset and are
 * re-verified by tests/sandbox (real execution) on every run.
 */

const RETAIL_SCHEMA: SqlTableSchema[] = [
  {
    name: "customers",
    columns: [
      { name: "id", type: "integer", note: "primary key" },
      { name: "name", type: "text" },
      { name: "city", type: "text", note: "may be NULL" },
      { name: "signup_date", type: "date" },
    ],
  },
  {
    name: "products",
    columns: [
      { name: "id", type: "integer", note: "primary key" },
      { name: "name", type: "text" },
      { name: "category", type: "text" },
      { name: "price", type: "numeric(10,2)" },
    ],
  },
  {
    name: "orders",
    columns: [
      { name: "id", type: "integer", note: "primary key" },
      { name: "customer_id", type: "integer", note: "→ customers.id" },
      { name: "order_date", type: "date" },
      { name: "status", type: "text", note: "COMPLETED | PENDING | CANCELLED" },
    ],
  },
  {
    name: "order_items",
    columns: [
      { name: "order_id", type: "integer", note: "→ orders.id" },
      { name: "product_id", type: "integer", note: "→ products.id" },
      { name: "quantity", type: "integer" },
    ],
  },
];

const RETAIL_SAMPLE: SqlSampleData[] = [
  {
    table: "customers",
    columns: ["id", "name", "city", "signup_date"],
    rows: [
      [1, "Asha Rao", "Pune", "2025-01-05"],
      [2, "Ben Carter", "Mumbai", "2025-01-19"],
      [3, "Chen Li", "Pune", "2025-02-02"],
      [4, "Divya Nair", "Bengaluru", "2025-02-14"],
      [5, "Elena Petrova", "Mumbai", "2025-03-01"],
    ],
  },
  {
    table: "products",
    columns: ["id", "name", "category", "price"],
    rows: [
      [1, "Laptop Stand", "Accessories", "1499.00"],
      [2, "USB-C Hub", "Accessories", "2499.50"],
      [3, "Mechanical Keyboard", "Peripherals", "5999.00"],
      [4, "Wireless Mouse", "Peripherals", "1299.99"],
      [5, "27in Monitor", "Displays", "18999.00"],
    ],
  },
  {
    table: "orders",
    columns: ["id", "customer_id", "order_date", "status"],
    rows: [
      [1, 1, "2025-06-01", "COMPLETED"],
      [2, 2, "2025-06-03", "COMPLETED"],
      [3, 3, "2025-06-05", "CANCELLED"],
      [4, 4, "2025-06-08", "COMPLETED"],
      [5, 5, "2025-06-10", "COMPLETED"],
    ],
  },
  {
    table: "order_items",
    columns: ["order_id", "product_id", "quantity"],
    rows: [
      [1, 1, 2],
      [1, 4, 1],
      [2, 5, 1],
      [3, 3, 1],
      [4, 2, 1],
    ],
  },
];

const SQL_LIMITS: SqlLimits = { timeoutMs: 3000, maxRows: 500, maxResultBytes: 128 * 1024 };
const STARTER = "SELECT *\nFROM customers\nLIMIT 10;\n";
const CONSTRAINTS = [
  "PostgreSQL 16. Tables live in the default schema — no prefix needed.",
  "A single read query only (SELECT / WITH / VALUES / TABLE). The database is read-only.",
  "Graded by comparing your result rows with the expected result, not by your SQL text.",
];

export const SQL_CUSTOMERS_PER_CITY: SqlTask = {
  kind: "SQL",
  key: "sql-customers-per-city",
  version: 1,
  difficulty: "EASY",
  title: "Customers per city",
  instructions: [
    "Return one row per city with the number of customers in that city.",
    "Exclude customers whose city is NULL.",
    "Columns: city, customer_count. Order by customer_count descending, then city ascending.",
  ].join("\n\n"),
  constraints: [...CONSTRAINTS, "Row order matters for this task."],
  datasetKey: "retail_v1",
  schema: RETAIL_SCHEMA,
  sampleData: RETAIL_SAMPLE,
  starterQuery: STARTER,
  expectedResult: {
    columns: ["city", "customer_count"],
    rows: [
      ["Bengaluru", 3],
      ["Mumbai", 3],
      ["Pune", 3],
      ["Delhi", 2],
      ["Chennai", 1],
    ],
  },
  comparison: { orderMatters: true, checkColumnNames: false, numericScale: 2 },
  limits: SQL_LIMITS,
  timeLimitMinutes: 20,
};

export const SQL_REVENUE_BY_CATEGORY: SqlTask = {
  kind: "SQL",
  key: "sql-revenue-by-category",
  version: 1,
  difficulty: "MEDIUM",
  title: "Completed revenue by product category",
  instructions: [
    "Revenue for an order line is products.price × order_items.quantity.",
    "Only count orders whose status is COMPLETED.",
    "Return one row per product category with its total revenue.",
    "Columns: category, revenue. Order by revenue descending.",
  ].join("\n\n"),
  constraints: [...CONSTRAINTS, "Row order matters for this task.", "Revenue is compared to 2 decimal places."],
  datasetKey: "retail_v1",
  schema: RETAIL_SCHEMA,
  sampleData: RETAIL_SAMPLE,
  starterQuery: STARTER,
  expectedResult: {
    columns: ["category", "revenue"],
    rows: [
      ["Displays", 56997.0],
      ["Peripherals", 32493.95],
      ["Office", 30393.5],
      ["Accessories", 18992.0],
    ],
  },
  comparison: { orderMatters: true, checkColumnNames: false, numericScale: 2 },
  limits: SQL_LIMITS,
  timeLimitMinutes: 30,
};

export const SQL_TOP_CUSTOMER_PER_CITY: SqlTask = {
  kind: "SQL",
  key: "sql-top-customer-per-city",
  version: 1,
  difficulty: "HARD",
  title: "Top customer per city",
  instructions: [
    "A customer's total revenue is the sum of price × quantity over their COMPLETED orders.",
    "For each city, return the customer with the highest total revenue. If two customers tie, pick the one with the lower customer id.",
    "Ignore customers with a NULL city and customers without any completed order (a city with no such customer does not appear).",
    "Columns: city, customer_name, total_revenue. Any row order is accepted.",
  ].join("\n\n"),
  constraints: [...CONSTRAINTS, "Row order does not matter for this task.", "Revenue is compared to 2 decimal places."],
  datasetKey: "retail_v1",
  schema: RETAIL_SCHEMA,
  sampleData: RETAIL_SAMPLE,
  starterQuery: STARTER,
  expectedResult: {
    columns: ["city", "customer_name", "total_revenue"],
    rows: [
      ["Bengaluru", "Liam O'Neil", 5999.0],
      ["Delhi", "Farhan Ali", 14998.5],
      ["Mumbai", "Ben Carter", 22596.0],
      ["Pune", "Hiro Tanaka", 25497.0],
    ],
  },
  comparison: { orderMatters: false, checkColumnNames: false, numericScale: 2 },
  limits: SQL_LIMITS,
  timeLimitMinutes: 40,
};

export const SQL_TASKS: readonly SqlTask[] = [SQL_CUSTOMERS_PER_CITY, SQL_REVENUE_BY_CATEGORY, SQL_TOP_CUSTOMER_PER_CITY];
