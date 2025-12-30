// server.js
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const path = require('path');

const app = express();
const PORT = 3000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// MongoDB Connection
const MONGODB_URI = "mongodb+srv://hiddenguy:8YXnTmTRwTlIrVZI@project1.rvwfnr9.mongodb.net/chatting-app?retryWrites=true&w=majority&appName=Project1";

mongoose.connect(MONGODB_URI)
  .then(() => console.log('Connected to MongoDB database'))
  .catch((err) => console.error('Database connection failed:', err));

// Define Schemas
const couponSchema = new mongoose.Schema({
  code: {
    type: String,
    required: true,
    unique: true
  },
  amount: {
    type: Number,
    required: true
  },
  active: {
    type: Boolean,
    default: true
  }
});

const cashoutRequestSchema = new mongoose.Schema({
  coupon_code: {
    type: String,
    required: true
  },
  amount: {
    type: Number,
    required: true
  },
  cashout_number: {
    type: String,
    required: true
  },
  payment_method: {
    type: String,
    required: true,
    enum: ['bkash', 'nogod', 'rocket']
  },
  status: {
    type: String,
    enum: ['pending', 'approved', 'canceled'],
    default: 'pending'
  },
  trx_id: {
    type: String,
    default: null
  },
  admin_mobile: {
    type: String,
    default: null
  }
}, {
  timestamps: true
});

// Create Models
const Coupon = mongoose.model('Coupon', couponSchema);
const CashoutRequest = mongoose.model('CashoutRequest', cashoutRequestSchema);

// Initialize dummy coupons
const initializeCoupons = async () => {
  const dummyCoupons = [
    { code: 'RM100', amount: 100.00 },
    { code: 'RM200', amount: 200.00 },
    { code: 'RM500', amount: 500.00 },
    { code: 'RM1000', amount: 1000.00 }
  ];

  try {
    for (const coupon of dummyCoupons) {
      await Coupon.findOneAndUpdate(
        { code: coupon.code },
        coupon,
        { upsert: true, new: true }
      );
    }
    console.log('Dummy coupons initialized');
  } catch (err) {
    console.error('Error initializing coupons:', err);
  }
};

// Initialize coupons after connection
mongoose.connection.once('open', () => {
  initializeCoupons();
});

// ============ USER APIs ============

// 1a. Check coupon code
app.post('/api/user/check-coupon', async (req, res) => {
  try {
    const { couponCode } = req.body;

    if (!couponCode) {
      return res.status(400).json({ error: 'Coupon code is required' });
    }

    const coupon = await Coupon.findOne({ code: couponCode, active: true });

    if (!coupon) {
      return res.status(404).json({ error: 'Invalid or inactive coupon code' });
    }

    res.json({
      success: true,
      coupon: {
        code: coupon.code,
        amount: coupon.amount
      }
    });
  } catch (err) {
    res.status(500).json({ error: 'Database error' });
  }
});

// 1b. Submit cashout request
app.post('/api/user/cashout', async (req, res) => {
  try {
    const { couponCode, cashoutNumber, paymentMethod } = req.body;

    // Validation
    if (!couponCode || !cashoutNumber || !paymentMethod) {
      return res.status(400).json({ error: 'All fields are required' });
    }

    if (!['bkash', 'nogod', 'rocket'].includes(paymentMethod)) {
      return res.status(400).json({ error: 'Invalid payment method' });
    }

    // Check if coupon exists
    const coupon = await Coupon.findOne({ code: couponCode, active: true });

    if (!coupon) {
      return res.status(404).json({ error: 'Invalid coupon code' });
    }

    // Create cashout request
    const cashoutRequest = new CashoutRequest({
      coupon_code: couponCode,
      amount: coupon.amount,
      cashout_number: cashoutNumber,
      payment_method: paymentMethod
    });

    const savedRequest = await cashoutRequest.save();

    res.json({
      success: true,
      message: 'Cashout request submitted successfully',
      requestId: savedRequest._id
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to submit request' });
  }
});

// 1c. Get user history
app.get('/api/user/history/:cashoutNumber', async (req, res) => {
  try {
    const { cashoutNumber } = req.params;

    const history = await CashoutRequest.find({ cashout_number: cashoutNumber })
      .sort({ createdAt: -1 })
      .lean();

    res.json({
      success: true,
      history: history
    });
  } catch (err) {
    res.status(500).json({ error: 'Database error' });
  }
});

// ============ ADMIN APIs ============

// 2a. Get all requests
app.get('/api/admin/requests', async (req, res) => {
  try {
    const requests = await CashoutRequest.find()
      .sort({ createdAt: -1 })
      .lean();

    res.json({
      success: true,
      requests: requests
    });
  } catch (err) {
    res.status(500).json({ error: 'Database error' });
  }
});

// 2b. Update request status
app.put('/api/admin/requests/:id/status', async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body;

    if (!['pending', 'approved', 'canceled'].includes(status)) {
      return res.status(400).json({ error: 'Invalid status' });
    }

    const updatedRequest = await CashoutRequest.findByIdAndUpdate(
      id,
      { status: status },
      { new: true }
    );

    if (!updatedRequest) {
      return res.status(404).json({ error: 'Request not found' });
    }

    res.json({
      success: true,
      message: 'Status updated successfully'
    });
  } catch (err) {
    res.status(500).json({ error: 'Database error' });
  }
});

// 2c. Approve request with transaction details
app.put('/api/admin/requests/:id/approve', async (req, res) => {
  try {
    const { id } = req.params;
    const { trxId, adminMobile } = req.body;

    if (!trxId || !adminMobile) {
      return res.status(400).json({ error: 'Transaction ID and mobile number are required' });
    }

    const updatedRequest = await CashoutRequest.findByIdAndUpdate(
      id,
      { 
        status: 'approved',
        trx_id: trxId,
        admin_mobile: adminMobile
      },
      { new: true }
    );

    if (!updatedRequest) {
      return res.status(404).json({ error: 'Request not found' });
    }

    res.json({
      success: true,
      message: 'Request approved successfully'
    });
  } catch (err) {
    res.status(500).json({ error: 'Database error' });
  }
});

// Serve admin page
app.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
  console.log(`Admin panel: http://localhost:${PORT}/admin`);
});