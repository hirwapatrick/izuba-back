import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import User from "../models/User.js"

export const register = async (req, res) => {
  try {
    const { name, phoneNumber, bulbId, password } = req.body;

    if (!name || !phoneNumber || !bulbId || !password) {
      return res.status(400).json({ message: "All fields are required" });
    }

    const phoneExists = await User.findOne({ phoneNumber });
    if (phoneExists) {
      return res.status(400).json({ message: "Phone already registered" });
    }

    const bulbExists = await User.findOne({ bulbId });
    if (bulbExists) {
      return res.status(400).json({ message: "Bulb already linked" });
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    const user = await User.create({
      name,
      phoneNumber,
      bulbId,
      password: hashedPassword,
    });

    res.status(201).json({
      message: "Registered successfully",
      user: {
        id: user._id,
        name: user.name,
        phoneNumber: user.phoneNumber,
        bulbId: user.bulbId,
      },
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

export const login = async (req, res) => {
  try {
    const { phoneNumber, password } = req.body;

    const user = await User.findOne({ phoneNumber });
    if (!user) return res.status(404).json({ message: "User not found" });

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) return res.status(401).json({ message: "Invalid credentials" });

    const token = jwt.sign(
      { userId: user._id, bulbId: user.bulbId },
      process.env.JWT_SECRET,
      { expiresIn: "6d" }
    );

    res.json({
      message: "Login successful",
      user,
      token,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
