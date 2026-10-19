import { Navigate } from "react-router-dom";
import useAppContext from "../hooks/useAppContext";
import LoadingSpinner from "./LoadingSpinner"; 

type Props = {
  children: JSX.Element;
  roles?: Array<"user" | "admin" | "hotel_owner">;
};

const ProtectedRoute = ({ children, roles }: Props) => {
  const { isLoggedIn, user, isLoading } = useAppContext();

  if (isLoading) {
    return (
      <div className="flex justify-center items-center h-screen">
        <LoadingSpinner message="Checking authentication..." />
      </div>
    );
  }

  if (!isLoggedIn) {
    return <Navigate to="/sign-in" replace />;
  }

  if (roles && user && !roles.includes(user.role as any)) {
    return <Navigate to="/unauthorized" replace />;
  }

  return children;
};

export default ProtectedRoute;