// Renju.Infrastructure.Tests/Model/ sorts BEFORE Renju.Infrastructure/Model/
// alphabetically. Without dot-normalization in contextEndsWithPrefix,
// `using Renju.Infrastructure.Model;` from Core/ would falsely resolve here.
using Renju.Infrastructure.Model;

namespace Renju.Infrastructure.Tests.Model
{
    public class RenjuEntityTest
    {
        public void TestGetId()
        {
            var e = new RenjuEntity();
            e.GetId();
        }
    }
}
