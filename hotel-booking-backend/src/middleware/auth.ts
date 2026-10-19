import { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";

declare global {
  namespace Express {
    interface Request {
      userId: string;
      userRole: string; 
    }
  }
}

/**
 * Like `verifyToken`, but never rejects: if a valid `auth_token` cookie is
 * present it sets `req.userId`/`req.userRole`, otherwise the request continues
 * anonymously. Used for guest checkout, where an account is optional.
 */
export const optionalAuth = (
  req: Request,
  _res: Response,
  next: NextFunction
) => {
  const token = req.cookies?.["auth_token"];
  if (!token) return next();

  try {
    const decoded = jwt.verify(
      token,
      process.env.JWT_SECRET_KEY as string
    ) as { userId: string; userRole: string };
    req.userId = decoded.userId;
    req.userRole = decoded.userRole;
  } catch {
    // Invalid/expired token on an optional route → treat as guest.
  }
  next();
};

const verifyToken = (req: Request, res: Response, next: NextFunction) => {
  // 1. Preuzimanje tokena iz kolačića (HttpOnly)
  const token = req.cookies["auth_token"];

  if (!token) {
    // Ako nema tokena u kolačiću, korisnik je neautentifikovan
    return res.status(401).json({ message: "Unauthorized: No token provided" });
  }

  try {
    const decoded = jwt.verify(
      token,
      process.env.JWT_SECRET_KEY as string
    ) as { userId: string, userRole: string };

    req.userId = decoded.userId;
    req.userRole = decoded.userRole;

    next();
  } catch (error) {
    res.clearCookie("auth_token", { path: "/" });
    
    return res.status(401).json({ message: "Unauthorized: Invalid or expired token" });
  }
};

export default verifyToken;