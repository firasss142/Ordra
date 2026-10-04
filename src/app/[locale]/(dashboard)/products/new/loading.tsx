import { ProductsFrame } from "@/components/products/v6/ProductsFrame";
import { ProductEditSkeleton } from "@/components/products/v6/skeletons";

export default function ProductNewLoading() {
  return (
    <ProductsFrame>
      <ProductEditSkeleton />
    </ProductsFrame>
  );
}
