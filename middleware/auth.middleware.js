import jwt from "jsonwebtoken";
import 'dotenv/config';

const authMiddleware = (req, res, next) => {
  const authHeader = req.headers.authorization;

  // Check header existence
  if (!authHeader) {
    return res.status(401).json({
      ok: false,
      message: "Authorization header missing",
    });
  }

  // Check Bearer format
  if (!authHeader.startsWith("Bearer ")) {
    return res.status(401).json({
      ok: false,
      message: "Invalid authorization format",
    });
  }

  const token = authHeader.split(" ")[1];

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    // Attach user info to request
    req.user = {
      userId: decoded.userId,
      bulbId: decoded.bulbId,
    };

    next();
  } catch (error) {
    return res.status(401).json({
      ok: false,
      message: "Token is invalid or expired",
    });
  }
};

export default authMiddleware;
