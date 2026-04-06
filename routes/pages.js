const express = require('express');
const path = require('path');
const router = express.Router();

const viewsDir = path.join(__dirname, '..', 'views');

router.get('/kiosk', (req, res) => res.sendFile(path.join(viewsDir, 'kiosk.html')));
router.get('/display', (req, res) => res.sendFile(path.join(viewsDir, 'display.html')));
router.get('/operator', (req, res) => res.sendFile(path.join(viewsDir, 'operator.html')));
router.get('/admin', (req, res) => res.sendFile(path.join(viewsDir, 'admin.html')));

// Root redirects to admin
router.get('/', (req, res) => res.redirect('/admin'));

module.exports = router;
