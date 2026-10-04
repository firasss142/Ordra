import { ProductsFrame } from "@/components/products/v6/ProductsFrame";
import { ProductEditSkeleton } from "@/components/products/v6/skeletons";

export default function ProductEditLoading() {
  return (
    <ProductsFrame>
      <ProductEditSkeleton />
    </ProductsFrame>
  );
}
