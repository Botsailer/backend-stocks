//here i want to do foreginkey relation with user and mainuser

const mongoose = require('mongoose');
const { Schema } = mongoose;
const MainUserSchema = new Schema({
  //
  email: { type: String, required: true, unique: true },
  firstName: { type: String, required: true },
  lastName: { type: String, required: true },
  phoneNumber: { type: String },
  companyName: { type: String },
  companyLogo: {
    data: Buffer,
    contentType: String
  },
  createdAt: { type: Date, default: Date.now }
});