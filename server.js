// server.js
const express = require('express');
const mysql = require('mysql2');
const cors = require('cors');
const path = require('path');

const app = express();
const PORT = 3000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// MySQL Connection
const db = mysql.createConnection({
  host: '5.9.106.155',
  user: 'owner',
  password: 'Raktim01@',
  database: 'follower',
  port: 3306
});


db.connect((err) => {
  if (err) {
    console.error('Database connection failed:', err);
    return;
  }
  console.log('Connected to MySQL database');
});

// Create tables if not exists
const createTables = () => {
  const couponsTable = `
    CREATE TABLE IF NOT EXISTS coupons (
      id INT AUTO_INCREMENT PRIMARY KEY,
      code VARCHAR(50) UNIQUE NOT NULL,
      amount DECIMAL(10, 2) NOT NULL,
      active BOOLEAN DEFAULT true
    )
  `;

  const requestsTable = `
    CREATE TABLE IF NOT EXISTS cashout_requests (
      id INT AUTO_INCREMENT PRIMARY KEY,
      coupon_code VARCHAR(50) NOT NULL,
      amount DECIMAL(10, 2) NOT NULL,
      cashout_number VARCHAR(20) NOT NULL,
      payment_method VARCHAR(20) NOT NULL,
      status ENUM('pending', 'approved', 'canceled') DEFAULT 'pending',
      trx_id VARCHAR(50),
      admin_mobile VARCHAR(20),
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    )
  `;

  db.query(couponsTable, (err) => {
    if (err) console.error('Error creating coupons table:', err);
  });

  db.query(requestsTable, (err) => {
    if (err) console.error('Error creating requests table:', err);
  });

  // Insert dummy coupons
  const dummyCoupons = [
    ['RM100', 100.00],
    ['RM200', 200.00],
    ['RM500', 500.00],
    ['RM1000', 1000.00]
  ];

  dummyCoupons.forEach(([code, amount]) => {
    db.query(
      'INSERT IGNORE INTO coupons (code, amount) VALUES (?, ?)',
      [code, amount]
    );
  });
};

createTables();

// ============ USER APIs ============

// 1a. Check coupon code
app.post('/api/user/check-coupon', (req, res) => {
  const { couponCode } = req.body;

  if (!couponCode) {
    return res.status(400).json({ error: 'Coupon code is required' });
  }

  const query = 'SELECT * FROM coupons WHERE code = ? AND active = true';
  
  db.query(query, [couponCode], (err, results) => {
    if (err) {
      return res.status(500).json({ error: 'Database error' });
    }

    if (results.length === 0) {
      return res.status(404).json({ error: 'Invalid or inactive coupon code' });
    }

    res.json({
      success: true,
      coupon: {
        code: results[0].code,
        amount: results[0].amount
      }
    });
  });
});

// 1b. Submit cashout request
app.post('/api/user/cashout', (req, res) => {
  const { couponCode, cashoutNumber, paymentMethod } = req.body;

  // Validation
  if (!couponCode || !cashoutNumber || !paymentMethod) {
    return res.status(400).json({ error: 'All fields are required' });
  }

  if (!['bkash', 'nogod', 'rocket'].includes(paymentMethod)) {
    return res.status(400).json({ error: 'Invalid payment method' });
  }

  // Check if coupon exists
  db.query('SELECT * FROM coupons WHERE code = ? AND active = true', [couponCode], (err, results) => {
    if (err) {
      return res.status(500).json({ error: 'Database error' });
    }

    if (results.length === 0) {
      return res.status(404).json({ error: 'Invalid coupon code' });
    }

    const amount = results[0].amount;

    // Insert cashout request
    const insertQuery = `
      INSERT INTO cashout_requests (coupon_code, amount, cashout_number, payment_method)
      VALUES (?, ?, ?, ?)
    `;

    db.query(insertQuery, [couponCode, amount, cashoutNumber, paymentMethod], (err, result) => {
      if (err) {
        return res.status(500).json({ error: 'Failed to submit request' });
      }

      res.json({
        success: true,
        message: 'Cashout request submitted successfully',
        requestId: result.insertId
      });
    });
  });
});

// 1c. Get user history
app.get('/api/user/history/:cashoutNumber', (req, res) => {
  const { cashoutNumber } = req.params;

  const query = `
    SELECT id, coupon_code, amount, cashout_number, payment_method, 
           status, trx_id, admin_mobile, created_at, updated_at
    FROM cashout_requests
    WHERE cashout_number = ?
    ORDER BY created_at DESC
  `;

  db.query(query, [cashoutNumber], (err, results) => {
    if (err) {
      return res.status(500).json({ error: 'Database error' });
    }

    res.json({
      success: true,
      history: results
    });
  });
});

// ============ ADMIN APIs ============

// 2a. Get all requests
app.get('/api/admin/requests', (req, res) => {
  const query = `
    SELECT id, coupon_code, amount, cashout_number, payment_method, 
           status, trx_id, admin_mobile, created_at, updated_at
    FROM cashout_requests
    ORDER BY created_at DESC
  `;

  db.query(query, (err, results) => {
    if (err) {
      return res.status(500).json({ error: 'Database error' });
    }

    res.json({
      success: true,
      requests: results
    });
  });
});

// 2b. Update request status
app.put('/api/admin/requests/:id/status', (req, res) => {
  const { id } = req.params;
  const { status } = req.body;

  if (!['pending', 'approved', 'canceled'].includes(status)) {
    return res.status(400).json({ error: 'Invalid status' });
  }

  const query = 'UPDATE cashout_requests SET status = ? WHERE id = ?';

  db.query(query, [status, id], (err, result) => {
    if (err) {
      return res.status(500).json({ error: 'Database error' });
    }

    if (result.affectedRows === 0) {
      return res.status(404).json({ error: 'Request not found' });
    }

    res.json({
      success: true,
      message: 'Status updated successfully'
    });
  });
});

// 2c. Approve request with transaction details
app.put('/api/admin/requests/:id/approve', (req, res) => {
  const { id } = req.params;
  const { trxId, adminMobile } = req.body;

  if (!trxId || !adminMobile) {
    return res.status(400).json({ error: 'Transaction ID and mobile number are required' });
  }

  const query = `
    UPDATE cashout_requests 
    SET status = 'approved', trx_id = ?, admin_mobile = ?
    WHERE id = ?
  `;

  db.query(query, [trxId, adminMobile, id], (err, result) => {
    if (err) {
      return res.status(500).json({ error: 'Database error' });
    }

    if (result.affectedRows === 0) {
      return res.status(404).json({ error: 'Request not found' });
    }

    res.json({
      success: true,
      message: 'Request approved successfully'
    });
  });
});

// Serve admin page
app.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
  console.log(`Admin panel: http://localhost:${PORT}/admin`);
});