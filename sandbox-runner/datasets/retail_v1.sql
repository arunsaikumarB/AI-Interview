-- HireOS SQL assessment dataset "retail_v1" (synthetic; no real people or companies).
-- Loaded by the sandbox runner into schema `assessment` of each task database.
-- Changing this file changes its sha256, which makes the runner reload it — bump the
-- task version in src/lib/practical/tasks/sql.ts whenever expected results change.

CREATE TABLE customers (
  id          integer PRIMARY KEY,
  name        text    NOT NULL,
  city        text,
  signup_date date    NOT NULL
);

CREATE TABLE products (
  id       integer PRIMARY KEY,
  name     text          NOT NULL,
  category text          NOT NULL,
  price    numeric(10,2) NOT NULL
);

CREATE TABLE orders (
  id          integer PRIMARY KEY,
  customer_id integer NOT NULL REFERENCES customers(id),
  order_date  date    NOT NULL,
  status      text    NOT NULL CHECK (status IN ('COMPLETED', 'PENDING', 'CANCELLED'))
);

CREATE TABLE order_items (
  order_id   integer NOT NULL REFERENCES orders(id),
  product_id integer NOT NULL REFERENCES products(id),
  quantity   integer NOT NULL CHECK (quantity > 0),
  PRIMARY KEY (order_id, product_id)
);

INSERT INTO customers (id, name, city, signup_date) VALUES
  (1,  'Asha Rao',      'Pune',      '2025-01-05'),
  (2,  'Ben Carter',    'Mumbai',    '2025-01-19'),
  (3,  'Chen Li',       'Pune',      '2025-02-02'),
  (4,  'Divya Nair',    'Bengaluru', '2025-02-14'),
  (5,  'Elena Petrova', 'Mumbai',    '2025-03-01'),
  (6,  'Farhan Ali',    'Delhi',     '2025-03-09'),
  (7,  'Grace Kim',     'Bengaluru', '2025-03-22'),
  (8,  'Hiro Tanaka',   'Pune',      '2025-04-04'),
  (9,  'Isabel Gomez',  'Delhi',     '2025-04-18'),
  (10, 'Jonas Weber',   'Mumbai',    '2025-05-02'),
  (11, 'Kavita Shah',   'Chennai',   '2025-05-15'),
  (12, 'Liam O''Neil',  'Bengaluru', '2025-05-30'),
  (13, 'Maya Iyer',     NULL,        '2025-06-02');

INSERT INTO products (id, name, category, price) VALUES
  (1, 'Laptop Stand',        'Accessories', 1499.00),
  (2, 'USB-C Hub',           'Accessories', 2499.50),
  (3, 'Mechanical Keyboard', 'Peripherals', 5999.00),
  (4, 'Wireless Mouse',      'Peripherals', 1299.99),
  (5, '27in Monitor',        'Displays',    18999.00),
  (6, 'Webcam HD',           'Peripherals', 3499.00),
  (7, 'Desk Lamp',           'Office',      899.25),
  (8, 'Ergonomic Chair',     'Office',      12499.00);

INSERT INTO orders (id, customer_id, order_date, status) VALUES
  (1,  1,  '2025-06-01', 'COMPLETED'),
  (2,  2,  '2025-06-03', 'COMPLETED'),
  (3,  3,  '2025-06-05', 'CANCELLED'),
  (4,  4,  '2025-06-08', 'COMPLETED'),
  (5,  5,  '2025-06-10', 'COMPLETED'),
  (6,  1,  '2025-06-12', 'COMPLETED'),
  (7,  6,  '2025-06-15', 'PENDING'),
  (8,  7,  '2025-06-18', 'COMPLETED'),
  (9,  8,  '2025-06-20', 'COMPLETED'),
  (10, 9,  '2025-06-22', 'COMPLETED'),
  (11, 10, '2025-06-25', 'COMPLETED'),
  (12, 11, '2025-06-28', 'CANCELLED'),
  (13, 12, '2025-07-01', 'COMPLETED'),
  (14, 2,  '2025-07-03', 'COMPLETED'),
  (15, 4,  '2025-07-06', 'PENDING'),
  (16, 6,  '2025-07-09', 'COMPLETED'),
  (17, 3,  '2025-07-12', 'COMPLETED'),
  (18, 5,  '2025-07-15', 'COMPLETED'),
  (19, 9,  '2025-07-18', 'CANCELLED'),
  (20, 8,  '2025-07-21', 'COMPLETED');

INSERT INTO order_items (order_id, product_id, quantity) VALUES
  (1, 1, 2), (1, 4, 1),
  (2, 5, 1),
  (3, 3, 1),
  (4, 2, 1), (4, 6, 1),
  (5, 8, 1),
  (6, 3, 1), (6, 7, 2),
  (7, 5, 2),
  (8, 4, 3),
  (9, 1, 1), (9, 2, 2),
  (10, 6, 1),
  (11, 5, 1), (11, 4, 1),
  (12, 8, 1),
  (13, 3, 1),
  (14, 7, 4),
  (15, 1, 1),
  (16, 2, 1), (16, 8, 1),
  (17, 6, 2),
  (18, 1, 3),
  (19, 4, 2),
  (20, 5, 1);
