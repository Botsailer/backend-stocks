const express = require('express');
const router = express.Router();
const passport = require('passport');
const couponController = require('../controllers/couponController');
const requireAdmin = require('../middleware/requirreAdmin');

const requireAuth = passport.authenticate('jwt', { session: false });

/**
 * @swagger
 * tags:
 *   name: Coupons
 *   description: Discount coupon management
 * 
 * components:
 *   schemas:
 *     Coupon:
 *       type: object
 *       required:
 *         - code
 *         - discountType
 *         - discountValue
 *         - title
 *         - validUntil
 *       properties:
 *         _id:
 *           type: string
 *           format: objectid
 *         code:
 *           type: string
 *           example: "SAVE20"
 *           description: "Unique coupon code (uppercase alphanumeric)"
 *         discountType:
 *           type: string
 *           enum: [percentage, fixed]
 *           example: "percentage"
 *         discountValue:
 *           type: number
 *           example: 20
 *           description: "Discount value (percentage: 0-100, fixed: any positive amount)"
 *         title:
 *           type: string
 *           example: "20% Off Premium Bundle"
 *         description:
 *           type: string
 *           example: "Get 20% discount on all premium bundles"
 *         usageLimit:
 *           type: number
 *           example: 100
 *           description: "Maximum number of times coupon can be used (-1 for unlimited)"
 *         usedCount:
 *           type: number
 *           example: 15
 *         validFrom:
 *           type: string
 *           format: date-time
 *         validUntil:
 *           type: string
 *           format: date-time
 *         applicableProducts:
 *           type: object
 *           properties:
 *             portfolios:
 *               type: array
 *               items:
 *                 type: string
 *                 format: objectid
 *             bundles:
 *               type: array
 *               items:
 *                 type: string
 *                 format: objectid
 *             applyToAll:
 *               type: boolean
 *               example: true
 *         minOrderValue:
 *           type: number
 *           example: 100
 *         maxDiscountAmount:
 *           type: number
 *           example: 500
 *         userRestrictions:
 *           type: object
 *           properties:
 *             allowedUsers:
 *               type: array
 *               items:
 *                 type: string
 *                 format: objectid
 *             blockedUsers:
 *               type: array
 *               items:
 *                 type: string
 *                 format: objectid
 *             newUsersOnly:
 *               type: boolean
 *               example: false
 *             oneUsePerUser:
 *               type: boolean
 *               example: true
 *         status:
 *           type: string
 *           enum: [active, inactive, expired]
 *           example: "active"
 *         createdBy:
 *           type: string
 *           format: objectid
 *         createdAt:
 *           type: string
 *           format: date-time
 *         updatedAt:
 *           type: string
 *           format: date-time
 */

/**
 * @swagger
 * /api/admin/coupons:
 *   post:
 *     summary: Create a new coupon (Admin only)
 *     tags: [Coupons]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - code
 *               - discountType
 *               - discountValue
 *               - title
 *               - validUntil
 *             properties:
 *               code:
 *                 type: string
 *                 example: "SAVE20"
 *               discountType:
 *                 type: string
 *                 enum: [percentage, fixed]
 *                 example: "percentage"
 *               discountValue:
 *                 type: number
 *                 example: 20
 *               title:
 *                 type: string
 *                 example: "20% Off Premium Bundle"
 *               description:
 *                 type: string
 *                 example: "Get 20% discount on all premium bundles"
 *               usageLimit:
 *                 type: number
 *                 example: 100
 *               validFrom:
 *                 type: string
 *                 format: date-time
 *               validUntil:
 *                 type: string
 *                 format: date-time
 *                 example: "2025-12-31T23:59:59.000Z"
 *               applicableProducts:
 *                 type: object
 *                 properties:
 *                   portfolios:
 *                     type: array
 *                     items:
 *                       type: string
 *                       format: objectid
 *                   bundles:
 *                     type: array
 *                     items:
 *                       type: string
 *                       format: objectid
 *                   applyToAll:
 *                     type: boolean
 *                     example: true
 *               minOrderValue:
 *                 type: number
 *                 example: 100
 *               maxDiscountAmount:
 *                 type: number
 *                 example: 500
 *               userRestrictions:
 *                 type: object
 *                 properties:
 *                   newUsersOnly:
 *                     type: boolean
 *                     example: false
 *                   oneUsePerUser:
 *                     type: boolean
 *                     example: true
 *     responses:
 *       201:
 *         description: Coupon created successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 message:
 *                   type: string
 *                   example: "Coupon created successfully"
 *                 coupon:
 *                   $ref: '#/components/schemas/Coupon'
 *       400:
 *         description: Validation error
 *       401:
 *         description: Unauthorized - Admin access required
 *       409:
 *         description: Coupon code already exists
 */
router.post('/', requireAuth, requireAdmin, couponController.createCoupon);

/**
 * @swagger
 * /api/admin/coupons:
 *   get:
 *     summary: Get all coupons with filtering and pagination
 *     tags: [Coupons]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *           default: 1
 *         description: Page number
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 20
 *           maximum: 100
 *         description: Number of coupons per page
 *       - in: query
 *         name: status
 *         schema:
 *           type: string
 *           enum: [active, inactive, expired]
 *         description: Filter by coupon status
 *       - in: query
 *         name: discountType
 *         schema:
 *           type: string
 *           enum: [percentage, fixed]
 *         description: Filter by discount type
 *       - in: query
 *         name: search
 *         schema:
 *           type: string
 *         description: Search in code, title, or description
 *     responses:
 *       200:
 *         description: List of coupons
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 coupons:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/Coupon'
 *                 pagination:
 *                   type: object
 *                   properties:
 *                     currentPage:
 *                       type: integer
 *                     totalPages:
 *                       type: integer
 *                     totalCoupons:
 *                       type: integer
 *                     hasNext:
 *                       type: boolean
 *                     hasPrev:
 *                       type: boolean
 *       401:
 *         description: Unauthorized - Admin access required
 */
router.get('/', requireAuth, requireAdmin, couponController.getAllCoupons);

/**
 * @swagger
 * /api/admin/coupons/{id}:
 *   get:
 *     summary: Get coupon by ID
 *     tags: [Coupons]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: objectid
 *     responses:
 *       200:
 *         description: Coupon details
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 coupon:
 *                   $ref: '#/components/schemas/Coupon'
 *       401:
 *         description: Unauthorized - Admin access required
 *       404:
 *         description: Coupon not found
 */
router.get('/:id', requireAuth, requireAdmin, couponController.getCouponById);

/**
 * @swagger
 * /api/admin/coupons/{id}:
 *   put:
 *     summary: Update a coupon (Admin only)
 *     tags: [Coupons]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: objectid
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               code:
 *                 type: string
 *               discountType:
 *                 type: string
 *                 enum: [percentage, fixed]
 *               discountValue:
 *                 type: number
 *               title:
 *                 type: string
 *               description:
 *                 type: string
 *               status:
 *                 type: string
 *                 enum: [active, inactive]
 *               validUntil:
 *                 type: string
 *                 format: date-time
 *     responses:
 *       200:
 *         description: Coupon updated successfully
 *       400:
 *         description: Validation error
 *       401:
 *         description: Unauthorized - Admin access required
 *       404:
 *         description: Coupon not found
 *       409:
 *         description: Coupon code already exists
 */
router.put('/:id', requireAuth, requireAdmin, couponController.updateCoupon);

/**
 * @swagger
 * /api/admin/coupons/{id}:
 *   delete:
 *     summary: Delete a coupon (Admin only)
 *     tags: [Coupons]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: objectid
 *     responses:
 *       200:
 *         description: Coupon deleted successfully
 *       400:
 *         description: Cannot delete used coupon
 *       401:
 *         description: Unauthorized - Admin access required
 *       404:
 *         description: Coupon not found
 */
router.delete('/:id', requireAuth, requireAdmin, couponController.deleteCoupon);

/**
 * @swagger
 * /api/admin/coupons/validate:
 *   post:
 *     summary: Validate and calculate discount for a coupon
 *     tags: [Coupons]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - code
 *               - productType
 *               - productId
 *               - orderValue
 *             properties:
 *               code:
 *                 type: string
 *                 example: "SAVE20"
 *               productType:
 *                 type: string
 *                 enum: [Portfolio, Bundle]
 *                 example: "Bundle"
 *               productId:
 *                 type: string
 *                 format: objectid
 *               orderValue:
 *                 type: number
 *                 example: 299.99
 *     responses:
 *       200:
 *         description: Coupon validation successful
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 message:
 *                   type: string
 *                   example: "Coupon is valid"
 *                 coupon:
 *                   type: object
 *                   properties:
 *                     code:
 *                       type: string
 *                     title:
 *                       type: string
 *                     description:
 *                       type: string
 *                     discountType:
 *                       type: string
 *                     discountValue:
 *                       type: number
 *                 discount:
 *                   type: number
 *                   example: 59.99
 *                 finalAmount:
 *                   type: number
 *                   example: 240
 *                 originalAmount:
 *                   type: number
 *                   example: 299.99
 *                 savings:
 *                   type: number
 *                   example: 59.99
 *       400:
 *         description: Invalid coupon or validation failed
 *       404:
 *         description: Coupon not found
 */
router.post('/validate', requireAuth, couponController.validateCoupon);

/**
 * @swagger
 * /api/admin/coupons/{id}/stats:
 *   get:
 *     summary: Get coupon usage statistics (Admin only)
 *     tags: [Coupons]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: objectid
 *     responses:
 *       200:
 *         description: Coupon usage statistics
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 stats:
 *                   type: object
 *                   properties:
 *                     basicInfo:
 *                       type: object
 *                     usage:
 *                       type: object
 *                     timeline:
 *                       type: object
 *                 recentUsageHistory:
 *                   type: array
 *       401:
 *         description: Unauthorized - Admin access required
 *       404:
 *         description: Coupon not found
 */
router.get('/:id/stats', requireAuth, requireAdmin, couponController.getCouponStats);

module.exports = router;
